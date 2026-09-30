import { BadRequestException, Injectable, Logger, Optional } from '@nestjs/common';
import {
  paymentReportTypeLabel,
  type Deal,
  type PaymentReportPage,
  type PaymentReportQuery,
  type PaymentReportRow,
  type PaymentReportTotals,
} from '@bitcrm/types';
import { isAssignedOnly, type Caller } from '../../common/access';
import { InvalidCursorError, decodeCursor, encodeCursor } from '../../common/cursor';
import { CrmClient } from '../../integrations/crm.client';
import { DealClient } from '../../integrations/deal.client';
import { UserClient } from '../../integrations/user.client';
import { PaymentReportRepository, type LineWalkCursor } from './payment-report.repository';
import {
  PAYMENT_REPORT_TZ,
  addDays,
  aggregatePlan,
  businessDay,
  csvHeader,
  csvLine,
  dayStartUtc,
  emptyTotals,
  expandTypes,
  isDay,
  lastDayOf,
  matchesSearch,
  monthCounts,
  parseSearch,
  totalsFrom,
  totalsFromLines,
  type ReportFilter,
  type ReportLine,
} from './payment-report.rules';

/** Workiz's page sizes are 5–100; the list never answers more than 100 lines. */
const MAX_PAGE = 100;
/** A CSV of a Custom range (≤ 12 months, as Workiz allows) fits well inside this. */
export const PAYMENT_REPORT_EXPORT_MAX_ROWS = 25_000;

const JOB_STATUS_LABELS: Record<string, string> = {
  submitted: 'Submitted',
  in_progress: 'In progress',
  pending: 'Pending',
  done_pending_approval: 'Done pending approval',
  done: 'Done',
  canceled: 'Canceled',
};

/** The resolved window: business days and the instants they span. */
interface Window {
  fromDay: string;
  toDay: string;
  fromIso: string;
  toIso: string;
}

/**
 * The Payments report (Workiz Reports → Payments). Reads the report's own
 * projection (`PAYLINE#` lines, `PAYAGG#` buckets) — never the ledger's
 * list index — so "All time" costs a few bucket Queries, not a read of every
 * payment, and the cards and the list are counted from the same lines.
 */
@Injectable()
export class PaymentReportService {
  private readonly logger = new Logger(PaymentReportService.name);

  constructor(
    private readonly repo: PaymentReportRepository,
    @Optional() private readonly deal?: DealClient,
    @Optional() private readonly crm?: CrmClient,
    @Optional() private readonly users?: UserClient,
  ) {}

  /** The two cards (+ per type) for the whole filtered range. */
  async totals(query: PaymentReportQuery, caller: Caller): Promise<PaymentReportTotals> {
    const window = await this.window(query);
    if (!window) return emptyTotals();
    const filter = this.filter(query, caller);
    const search = parseSearch(query.search);
    if (search) {
      const months = await this.months(window, filter, 'desc');
      const { lines } = await this.repo.walkLines({
        cursor: { ms: months },
        ...window,
        dir: 'desc',
        filter,
        want: Number.MAX_SAFE_INTEGER,
        accept: (l) => matchesSearch(l, search),
        maxRounds: 150,
      });
      return totalsFromLines(lines);
    }
    const rows = await this.repo.readBuckets(aggregatePlan(window.fromDay, window.toDay));
    return totalsFrom(rows, filter);
  }

  /** One page of lines, newest first by default; the first page also carries the totals. */
  async list(query: PaymentReportQuery, caller: Caller, authorization?: string): Promise<PaymentReportPage> {
    const limit = Math.min(Math.max(Number(query.limit) || 10, 1), MAX_PAGE);
    const dir = query.dir === 'asc' ? 'asc' : 'desc';
    const window = await this.window(query);
    if (!window) return { items: [], ...(query.cursor ? {} : { totals: emptyTotals() }) };
    const filter = this.filter(query, caller);
    const search = parseSearch(query.search);

    let cursor: LineWalkCursor;
    let totals: PaymentReportTotals | undefined;
    if (query.cursor) {
      cursor = this.decode(query.cursor);
    } else {
      const rows = await this.repo.readBuckets(aggregatePlan(window.fromDay, window.toDay));
      cursor = { ms: sortMonths([...monthCounts(rows, filter).keys()], dir) };
      totals = search ? await this.totals(query, caller) : totalsFrom(rows, filter);
    }

    const { lines, next } = await this.repo.walkLines({
      cursor,
      ...window,
      dir,
      filter,
      want: limit,
      ...(search && { accept: (l: ReportLine) => matchesSearch(l, search) }),
    });
    return {
      items: await this.rows(lines, authorization),
      ...(next && { nextCursor: encodeCursor(next) }),
      ...(totals && { totals }),
    };
  }

  /**
   * The CSV Workiz's Export produces — its own column set (Service Fee, Net
   * and Job status are CSV-only), MM/DD/YYYY dates, "Paid" for a collected
   * line. Answered inside the envelope, like Workiz's `csvData`.
   */
  async exportCsv(
    query: PaymentReportQuery,
    caller: Caller,
    authorization?: string,
  ): Promise<{ filename: string; csv: string; count: number; truncated: boolean }> {
    const window = await this.window(query);
    const out: string[] = [csvHeader()];
    if (!window) return { filename: 'Payment report.csv', csv: `${out[0]}\n`, count: 0, truncated: false };
    const filter = this.filter(query, caller);
    const search = parseSearch(query.search);
    const dir = query.dir === 'asc' ? 'asc' : 'desc';

    let cursor: LineWalkCursor | undefined = { ms: await this.months(window, filter, dir) };
    let count = 0;
    let truncated = false;
    while (cursor && cursor.ms.length) {
      const want = Math.min(500, PAYMENT_REPORT_EXPORT_MAX_ROWS - count);
      if (want <= 0) {
        truncated = true;
        break;
      }
      const page = await this.repo.walkLines({
        cursor,
        ...window,
        dir,
        filter,
        want,
        ...(search && { accept: (l: ReportLine) => matchesSearch(l, search) }),
        maxRounds: 200,
      });
      for (const row of await this.rows(page.lines, authorization)) {
        out.push(
          csvLine({
            ...row,
            confirmationCode: row.confirmationCode,
            serviceFee: row.serviceFee,
            net: row.net,
          }),
        );
      }
      count += page.lines.length;
      cursor = page.next;
    }
    return { filename: 'Payment report.csv', csv: `${out.join('\n')}\n`, count, truncated };
  }

  // ------------------------------------------------------------- internals

  /**
   * The window in business days. Both ends absent = "All time", bounded by
   * the first and last month the report has ever seen; nothing seen = no window.
   */
  private async window(query: PaymentReportQuery): Promise<Window | null> {
    const from = query.from || undefined;
    const to = query.to || undefined;
    if (from && !isDay(from)) throw new BadRequestException('`from` must be a date, YYYY-MM-DD');
    if (to && !isDay(to)) throw new BadRequestException('`to` must be a date, YYYY-MM-DD');
    if (from && to && from > to) throw new BadRequestException('`from` must not be after `to`');

    let fromDay = from;
    let toDay = to;
    if (!fromDay || !toDay) {
      const index = await this.repo.getIndex();
      const today = businessDay(new Date().toISOString(), PAYMENT_REPORT_TZ);
      if (!fromDay) {
        // Nothing projected yet and no lower bound: there is nothing to list.
        if (!index.firstMonth && !toDay) return null;
        fromDay = index.firstMonth ? `${index.firstMonth}-01` : toDay!;
      }
      if (!toDay) {
        const last = index.lastMonth ? lastDayOf(index.lastMonth) : today;
        toDay = last > today ? last : today;
      }
      if (fromDay > toDay) return null;
    }
    return {
      fromDay: fromDay!,
      toDay: toDay!,
      fromIso: dayStartUtc(fromDay!, PAYMENT_REPORT_TZ),
      toIso: dayStartUtc(addDays(toDay!, 1), PAYMENT_REPORT_TZ),
    };
  }

  /** Workiz's filter groups; `assigned_only` sees only lines of jobs they lead. */
  private filter(query: PaymentReportQuery, caller: Caller): ReportFilter {
    const technicianIds = isAssignedOnly(caller, 'payments') ? [caller.user.id] : clean(query.technicianIds);
    return {
      types: expandTypes(clean(query.types)),
      technicianIds,
      serviceAreaIds: clean(query.serviceAreaIds),
    };
  }

  private async months(window: Window, filter: ReportFilter, dir: 'asc' | 'desc'): Promise<string[]> {
    const rows = await this.repo.readBuckets(aggregatePlan(window.fromDay, window.toDay));
    return sortMonths([...monthCounts(rows, filter).keys()], dir);
  }

  private decode(raw: string): LineWalkCursor {
    try {
      const c = decodeCursor<Record<string, unknown>>(raw)!;
      const ms = Array.isArray(c.ms) ? c.ms.filter((m): m is string => typeof m === 'string' && /^\d{4}-\d{2}$/.test(m)) : [];
      const k = c.k as { PK?: unknown; SK?: unknown } | undefined;
      return {
        ms,
        ...(k && typeof k.PK === 'string' && typeof k.SK === 'string' && { k: { PK: k.PK, SK: k.SK } }),
      };
    } catch (err) {
      if (err instanceof InvalidCursorError) throw new BadRequestException('Invalid cursor');
      throw err;
    }
  }

  /** Lines → table rows, with the job, client, technician and collector names joined in. */
  private async rows(lines: ReportLine[], authorization?: string): Promise<PaymentReportRow[]> {
    if (lines.length === 0) return [];
    const dealIds = unique(lines.map((l) => l.dealId));
    const contactIds = unique(lines.map((l) => l.contactId));
    const userIds = unique(lines.flatMap((l) => [l.technicianId, l.collectedById]));

    const [deals, contacts, users, jobTypes] = await Promise.all([
      this.chunked(dealIds, 100, (ids) => this.deal?.getDealsByIds(ids, authorization) ?? Promise.resolve([] as Deal[]), 'deals'),
      this.chunked(contactIds, 100, (ids) => this.crm?.contactNamesByIds(ids) ?? Promise.resolve([]), 'contacts'),
      this.chunked(userIds, 200, (ids) => this.users?.namesByIds(ids) ?? Promise.resolve([]), 'users'),
      (this.deal?.listJobTypes() ?? Promise.resolve([])).catch(() => []),
    ]);
    const dealMap = new Map(deals.map((d) => [d.id, d]));
    const contactMap = new Map(contacts.map((c) => [c.id, fullName(c)]));
    const userMap = new Map(users.map((u) => [u.id, fullName(u)]));
    const jobTypeMap = new Map(jobTypes.map((t) => [t.id, t.name]));

    return lines.map((l) => {
      const deal = dealMap.get(l.dealId);
      const clientName =
        contactMap.get(l.contactId) || (deal?.clientName ? fullName(deal.clientName) : undefined) || undefined;
      const technicianName = l.technicianId ? userMap.get(l.technicianId) : undefined;
      const collectedByName = l.collectedByName || (l.collectedById ? userMap.get(l.collectedById) : undefined);
      const dealNumber = deal?.dealNumber ?? l.dealNumber;
      const jobTypeName = deal?.jobTypeId ? jobTypeMap.get(deal.jobTypeId) : undefined;
      const jobStatus = deal?.superStatus ? JOB_STATUS_LABELS[deal.superStatus] ?? deal.superStatus : undefined;
      const row: PaymentReportRow = {
        id: l.lineId,
        kind: l.kind,
        paymentId: l.paymentId,
        ...(l.refundId && { refundId: l.refundId }),
        dealId: l.dealId,
        ...(dealNumber && { dealNumber }),
        at: l.at,
        amount: l.amount,
        tip: l.tip,
        type: l.type,
        typeLabel: paymentReportTypeLabel(l.type),
        ...(l.status && { status: l.status }),
        ...(l.reference && { confirmationCode: l.reference }),
        ...(l.description && { description: l.description }),
        contactId: l.contactId,
        ...(clientName && { clientName }),
        ...(l.last4 && { card: `XXXX${l.last4}` }),
        ...(l.technicianId && { technicianId: l.technicianId }),
        ...(technicianName && { technicianName }),
        ...(l.serviceAreaId && { serviceAreaId: l.serviceAreaId }),
        ...(l.transactionMethod && { transactionMethod: l.transactionMethod }),
        ...(l.collectedById && { collectedById: l.collectedById }),
        ...(collectedByName && { collectedByName }),
        ...(deal?.jobTypeId && { jobTypeId: deal.jobTypeId }),
        ...(jobTypeName && { jobTypeName }),
        ...(jobStatus && { jobStatus }),
        serviceFee: l.fee,
        net: l.net,
      };
      return row;
    });
  }

  /** A lookup in slices of `size`; a peer that is down leaves names empty, never fails the report. */
  private async chunked<T>(ids: string[], size: number, fetch: (ids: string[]) => Promise<T[]>, what: string): Promise<T[]> {
    const out: T[] = [];
    for (let i = 0; i < ids.length; i += size) {
      try {
        out.push(...(await fetch(ids.slice(i, i + size))));
      } catch (err) {
        this.logger.warn(`payments report: ${what} lookup failed: ${(err as Error).message}`);
      }
    }
    return out;
  }
}

function clean(list: string[] | string | undefined): string[] {
  const arr = Array.isArray(list) ? list : typeof list === 'string' ? list.split(',') : [];
  return unique(arr.map((s) => s.trim()).filter(Boolean));
}

function unique(list: Array<string | undefined>): string[] {
  return [...new Set(list.filter((s): s is string => !!s))];
}

const fullName = (p: { firstName?: string; lastName?: string }): string =>
  `${p.firstName ?? ''} ${p.lastName ?? ''}`.trim();

function sortMonths(months: string[], dir: 'asc' | 'desc'): string[] {
  const sorted = [...months].sort();
  return dir === 'desc' ? sorted.reverse() : sorted;
}
