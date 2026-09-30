import { Injectable, Optional } from '@nestjs/common';
import type {
  AgingBucket,
  AgingReport,
  AgingSort,
  Invoice,
  InvoiceDaysDue,
  InvoiceReportStatus,
  InvoiceReportSummary,
  ListCount,
  ReportCsvExport,
} from '@bitcrm/types';
import { isAssignedOnly, type Caller } from '../../common/access';
import { decodeCursor, encodeCursor } from '../../common/cursor';
import { CrmClient } from '../../integrations/crm.client';
import { DealClient } from '../../integrations/deal.client';
import { reportClients } from '../../integrations/report-clients';
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
@Injectable()
export class InvoiceReportService {
  constructor(
    private readonly unpaid: UnpaidInvoicesRepository,
    private readonly listRepo: InvoiceReportRepository,
    private readonly crm: CrmClient,
    private readonly deal: DealClient,
    @Optional() private readonly invoices?: InvoicesService,
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

  async list(q: InvoiceReportQuery, caller: Caller): Promise<{ items: Invoice[]; nextCursor?: string }> {
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
      result = { ...result, items: result.items.filter((i) => mine.has(i.dealId)) };
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
    const clients = await reportClients(this.crm, items.map((i) => i.contactId), authorization);
    const span = q.from || q.to ? `${q.from ?? 'start'}_${q.to ?? today}` : 'all-time';
    return {
      filename: `invoices-${span}.csv`,
      csv: [INVOICE_CSV_HEADERS.join(','), ...items.map((i) => invoiceCsvLine(i, clients.get(i.contactId)))].join('\n'),
      count: items.length,
      truncated,
    };
  }

  // -------------------------------------------------------------- helpers

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
    return items.filter((i) => mine.has(i.dealId));
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
