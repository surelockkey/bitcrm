import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import {
  COUNTED_PAYMENT_STATUSES,
  invoiceReportFigures,
  type AgingBucket,
  type AgingReport,
  type AgingSort,
  type Invoice,
  type InvoiceDaysDue,
  type InvoiceReportFigures,
  type InvoiceReportRow,
  type InvoiceReportStatus,
  type InvoiceReportSummary,
  type ListCount,
  type Payment,
  type ReportCsvExport,
} from '@bitcrm/types';
import { isAssignedOnly, type Caller } from '../../common/access';
import { decodeCursor, encodeCursor } from '../../common/cursor';
import { CrmClient } from '../../integrations/crm.client';
import { DealClient } from '../../integrations/deal.client';
import { reportClients } from '../../integrations/report-clients';
import { PaymentsRepository } from '../../payments/payments.repository';
import { InvoicesService } from '../invoices.service';
import { UnpaidInvoicesRepository } from '../unpaid-invoices.repository';
import { InvoiceReportRepository } from './invoice-report.repository';
import {
  AGING_CSV_HEADERS,
  INVOICE_CSV_HEADERS,
  agingCards,
  agingCsvLine,
  agingRow,
  dayWindow,
  inAgingBucket,
  invoiceCards,
  invoiceCsvLine,
  isOpen,
  matchesFilter,
  onlyOpen,
  reportToday,
  sortAging,
  type InvoiceReportFilter,
} from './invoice-report.rules';

/** The export stops here (`truncated: true`), like the Payments report's. */
export const INVOICE_REPORT_EXPORT_MAX_ROWS = 25_000;

export interface AgingQuery {
  bucket?: AgingBucket;
  sort?: AgingSort;
  dir?: 'asc' | 'desc';
  page?: number;
  pageSize?: number;
}

export interface InvoiceReportQuery {
  /** Business days (America/New_York), inclusive; both absent = All time. */
  from?: string;
  to?: string;
  statuses?: InvoiceReportStatus[];
  daysDue?: InvoiceDaysDue[];
  sent?: Array<'sent' | 'unsent'>;
  search?: string;
  limit?: number;
  cursor?: string;
}

/**
 * Workiz's invoice reports: Aging invoices (`/root/agingInvoices`) and the
 * Invoices page's cards, "Filter results" and CSV (`/root/invoices`).
 *
 * The open invoices — the only ones Aging, the cards and "Days due" are ever
 * about — come off UnpaidIndex (~600 rows); a filter that may select a paid
 * invoice walks the list index on its created-date window instead.
 */
/** A job's payments, as the report reads the tips off them. */
export interface TipLedger {
  listByInvoice(invoiceId: string): Promise<Payment[]>;
}

const DEAL_CHUNK = 100;
const PARALLEL = 4;

@Injectable()
export class InvoiceReportService {
  private readonly logger = new Logger(InvoiceReportService.name);

  constructor(
    private readonly unpaid: UnpaidInvoicesRepository,
    private readonly listRepo: InvoiceReportRepository,
    private readonly crm: CrmClient,
    private readonly deal: DealClient,
    @Optional() private readonly invoices?: InvoicesService,
    @Optional() @Inject(PaymentsRepository) private readonly ledger?: TipLedger,
  ) {}

  // ----------------------------------------------------------------- aging

  async aging(q: AgingQuery, caller: Caller, authorization?: string): Promise<AgingReport> {
    const today = reportToday();
    const bucket = q.bucket ?? 'all';
    const { open, indexReady } = await this.openInvoices(caller);
    const cards = agingCards(open, today);
    const pageSize = Math.min(Math.max(Number(q.pageSize) || 10, 1), 100);
    const page = Math.max(Number(q.page) || 1, 1);

    const rows = open.filter((i) => inAgingBucket(i, bucket, today)).map((i) => agingRow(i, today));
    // A client-name sort needs every name; any other sort names only the page.
    if (q.sort === 'client') await this.nameRows(rows, authorization);
    const sorted = sortAging(rows, q.sort ?? 'daysLate', q.dir ?? 'desc');
    const items = sorted.slice((page - 1) * pageSize, page * pageSize);
    if (q.sort !== 'client') await this.nameRows(items, authorization);

    return { asOf: today, bucket, cards, items, total: rows.length, page, pageSize, indexReady };
  }

  async agingExport(q: AgingQuery, caller: Caller, authorization?: string): Promise<ReportCsvExport> {
    const today = reportToday();
    const bucket = q.bucket ?? 'all';
    const { open } = await this.openInvoices(caller);
    const rows = open.filter((i) => inAgingBucket(i, bucket, today)).map((i) => agingRow(i, today));
    await this.nameRows(rows, authorization);
    const sorted = sortAging(rows, q.sort ?? 'daysLate', q.dir ?? 'desc');
    return {
      filename: `aging-invoices-${today}.csv`,
      csv: [AGING_CSV_HEADERS.join(','), ...sorted.map((r) => agingCsvLine(r))].join('\n'),
      count: sorted.length,
      truncated: false,
    };
  }

  // ------------------------------------------------------------ the cards

  async summary(
    q: Pick<InvoiceReportQuery, 'from' | 'to'>,
    caller: Caller,
    authorization?: string,
  ): Promise<InvoiceReportSummary> {
    const today = reportToday();
    const [{ open, indexReady }, needing] = await Promise.all([
      this.openInvoices(caller),
      this.invoices ? this.invoices.needingInvoice(authorization) : Promise.resolve([]),
    ]);
    const cards = invoiceCards(open, dayWindow(q.from, q.to), today);
    return {
      ...(q.from && { from: q.from }),
      ...(q.to && { to: q.to }),
      ...cards,
      needInvoices: { count: needing.length },
      indexReady,
    };
  }

  // ------------------------------------------------------------- the list

  async list(
    q: InvoiceReportQuery,
    caller: Caller,
    authorization?: string,
  ): Promise<{ items: InvoiceReportRow[]; nextCursor?: string }> {
    const page = await this.listPage(q, caller);
    const figures = await this.figuresFor(page.items, authorization);
    return {
      ...page,
      items: page.items.map((i) => ({ ...i, report: figures.get(i.id) ?? invoiceReportFigures(i) })),
    };
  }

  private async listPage(q: InvoiceReportQuery, caller: Caller): Promise<{ items: Invoice[]; nextCursor?: string }> {
    const today = reportToday();
    const filter = this.filterOf(q);
    const limit = Math.min(Math.max(Number(q.limit) || 10, 1), 100);
    let result: { items: Invoice[]; nextCursor?: string };

    if (onlyOpen(filter)) {
      // Every open invoice fits in memory: filter, order newest first, cut a page.
      const { open } = await this.openInvoices(caller);
      const all = open
        .filter((i) => matchesFilter(i, filter, today))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
      const offset = Number(decodeCursor<{ o?: number }>(q.cursor)?.o) || 0;
      const items = all.slice(offset, offset + limit);
      return {
        items,
        ...(offset + limit < all.length && { nextCursor: encodeCursor({ o: offset + limit }) }),
      };
    }

    result = await this.listRepo.page(filter, today, limit, q.cursor);
    if (isAssignedOnly(caller, 'invoices')) {
      const mine = await this.deal.listDealIdsByTech(caller.user.id);
      result = { ...result, items: result.items.filter((i) => !!i.dealId && mine.has(i.dealId)) };
    }
    return result;
  }

  async count(q: InvoiceReportQuery, caller: Caller): Promise<ListCount> {
    const today = reportToday();
    const filter = this.filterOf(q);
    if (onlyOpen(filter)) {
      const { open } = await this.openInvoices(caller);
      return { total: open.filter((i) => matchesFilter(i, filter, today)).length, atLeast: false };
    }
    // Page-local scope filter, as on the invoice list: no index walk answers it.
    if (isAssignedOnly(caller, 'invoices')) return { total: null, atLeast: false };
    return this.listRepo.count(filter, today);
  }

  async exportCsv(q: InvoiceReportQuery, caller: Caller, authorization?: string): Promise<ReportCsvExport> {
    const today = reportToday();
    const filter = this.filterOf(q);
    let items: Invoice[];
    let truncated = false;
    if (onlyOpen(filter)) {
      const { open } = await this.openInvoices(caller);
      items = open
        .filter((i) => matchesFilter(i, filter, today))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
    } else {
      ({ items, truncated } = await this.listRepo.walk(filter, today, INVOICE_REPORT_EXPORT_MAX_ROWS));
      items = await this.visible(items, caller);
    }
    const [clients, figures] = await Promise.all([
      reportClients(this.crm, items.map((i) => i.contactId), authorization),
      this.figuresFor(items, authorization),
    ]);
    const span = q.from || q.to ? `${q.from ?? 'start'}_${q.to ?? today}` : 'all-time';
    return {
      filename: `invoices-${span}.csv`,
      csv: [
        INVOICE_CSV_HEADERS.join(','),
        ...items.map((i) => invoiceCsvLine(i, clients.get(i.contactId), undefined, figures.get(i.id))),
      ].join('\n'),
      count: items.length,
      truncated,
    };
  }

  // -------------------------------------------------------------- helpers

  /**
   * Workiz's figures for a set of invoices (`invoiceReportFigures`): the card
   * service fee is the job's (a Workiz job keeps it as a line, its snapshot
   * names it — `totals.serviceFee`, read through `POST /deals/by-ids` as the
   * caller); the tip is Workiz's own on an imported invoice (`tipAmount`) and
   * the ledger's on one made here (Σ tips of the counted payments). A lookup
   * that fails leaves that part at 0 — the stored totals, never a failed page.
   */
  async figuresFor(items: Invoice[], authorization?: string): Promise<Map<string, InvoiceReportFigures>> {
    const out = new Map<string, InvoiceReportFigures>();
    if (!items.length) return out;

    const fees = new Map<string, number>();
    // Service fees live on the job; a client invoice (no job) has none.
    const dealIds = [...new Set(items.map((i) => i.dealId).filter((id): id is string => !!id))];
    const chunks: string[][] = [];
    for (let i = 0; i < dealIds.length; i += DEAL_CHUNK) chunks.push(dealIds.slice(i, i + DEAL_CHUNK));
    let dealsOk = !!authorization;
    for (let i = 0; dealsOk && i < chunks.length; i += PARALLEL) {
      await Promise.all(
        chunks.slice(i, i + PARALLEL).map(async (chunk) => {
          try {
            for (const d of await this.deal.getDealsByIds(chunk, authorization)) {
              const fee = (d.totals as { serviceFee?: unknown } | undefined)?.serviceFee;
              if (typeof fee === 'number' && fee > 0) fees.set(d.id, fee);
            }
          } catch (err) {
            dealsOk = false;
            this.logger.warn(`service fees unavailable (${(err as Error).message}); subtotals include them`);
          }
        }),
      );
    }

    const tips = new Map<string, number>();
    const native: Invoice[] = [];
    for (const inv of items) {
      if (inv.externalId?.startsWith('workiz:')) tips.set(inv.id, inv.tipAmount ?? 0);
      else native.push(inv);
    }
    if (this.ledger && native.length) {
      for (let i = 0; i < native.length; i += PARALLEL * 2) {
        await Promise.all(
          native.slice(i, i + PARALLEL * 2).map(async (inv) => {
            try {
              const rows = await this.ledger!.listByInvoice(inv.id);
              const cents = rows
                .filter((p) => COUNTED_PAYMENT_STATUSES.includes(p.status))
                .reduce(
                  (sum, p) =>
                    sum +
                    Math.round((p.tipAmount ?? 0) * 100) -
                    Math.round(((p as { tipRefundedAmount?: number }).tipRefundedAmount ?? 0) * 100),
                  0,
                );
              if (cents) tips.set(inv.id, cents / 100);
            } catch (err) {
              this.logger.warn(`tips unavailable for invoice ${inv.id}: ${(err as Error).message}`);
            }
          }),
        );
      }
    }

    for (const inv of items) {
      out.set(inv.id, invoiceReportFigures(inv, { tip: tips.get(inv.id) ?? 0, serviceFee: (inv.dealId && fees.get(inv.dealId)) || 0 }));
    }
    return out;
  }

  private filterOf(q: InvoiceReportQuery): InvoiceReportFilter {
    return {
      ...dayWindow(q.from, q.to),
      ...(q.statuses?.length && { statuses: q.statuses }),
      ...(q.daysDue?.length && { daysDue: q.daysDue }),
      ...(q.sent?.length && { sent: q.sent }),
      ...(q.search?.trim() && { search: q.search.trim() }),
    };
  }

  /** The open invoices the caller may see, and whether UnpaidIndex answered. */
  private async openInvoices(caller: Caller): Promise<{ open: Invoice[]; indexReady: boolean }> {
    const { items, indexReady } = await this.unpaid.listUnpaid();
    return { open: await this.visible(items.filter(isOpen), caller), indexReady };
  }

  private async visible(items: Invoice[], caller: Caller): Promise<Invoice[]> {
    if (!isAssignedOnly(caller, 'invoices')) return items;
    const mine = await this.deal.listDealIdsByTech(caller.user.id);
    return items.filter((i) => !!i.dealId && mine.has(i.dealId));
  }

  private async nameRows(
    rows: Array<{ contactId: string; clientName?: string; clientEmail?: string; clientPhone?: string }>,
    authorization?: string,
  ): Promise<void> {
    const clients = await reportClients(this.crm, rows.map((r) => r.contactId), authorization);
    for (const r of rows) {
      const c = clients.get(r.contactId);
      if (!c) continue;
      if (c.name) r.clientName = c.name;
      if (c.email) r.clientEmail = c.email;
      if (c.phone) r.clientPhone = c.phone;
    }
  }
}
