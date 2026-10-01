import { JobSuperStatus } from '../enums/deal-stage.enum';
import { type JobsReportBy, type JobsReportPagination } from './jobs-report';

/**
 * The Workiz Sales report (`/root/sales`), shared by deal-service
 * (`GET /deals/report/sales`, `/sales/export`, `/sales/settings`) and the
 * web page.
 *
 * One row per job with its money — total, tax, costs, paid, due, profit —
 * a bold Total row over the whole selection and a Sales / Profit line per
 * day. Checked live on 2026-09-30
 * (`workiz-data-parser/docs/reports/sales.md`):
 *
 * - a job is in when its status is anything but Canceled and its total is
 *   above zero (a job never priced is not a sale, whatever its status), and
 *   the chosen date — "By:" Job created / Job date / Job end date — falls
 *   in the period; days on the account's calendar (America/New_York), both
 *   ends included;
 * - Profit = Total − Tax − Item cost − Tech expenses − Labor cost − Card
 *   expenses: before the technician's share (Job Statistics' profit is after
 *   it), the tip is not taken off;
 * - Due = Total − Paid, below zero when a job is overpaid;
 * - Payment status: Paid when nothing is due, Partly paid when something is
 *   paid and something due, Due when nothing is paid.
 *
 * Workiz's fourth "By:" — the job's first payment date — needs an index on
 * that date and is not offered yet (see the spec, open question 1).
 */

/** The dates the period can be on — the Jobs report's three. Workiz's default is the Job date. */
export const SALES_REPORT_BY = ['created', 'scheduled', 'end'] as const satisfies readonly JobsReportBy[];
export type SalesReportBy = (typeof SALES_REPORT_BY)[number];

/** The statuses a sale can have — every one but Canceled, in Workiz's filter order. */
export const SALES_REPORT_STATUSES: readonly JobSuperStatus[] = [
  JobSuperStatus.SUBMITTED,
  JobSuperStatus.IN_PROGRESS,
  JobSuperStatus.DONE,
  JobSuperStatus.PENDING,
  JobSuperStatus.DONE_PENDING_APPROVAL,
];

/** Workiz's "Payment status" filter, in its order. */
export const SALES_REPORT_PAYMENT_STATUSES = [
  { id: 'paid', label: 'Paid' },
  { id: 'partly_paid', label: 'Partly paid' },
  { id: 'due', label: 'Due' },
] as const;
export type SalesReportPaymentStatus = (typeof SALES_REPORT_PAYMENT_STATUSES)[number]['id'];

/**
 * The report's columns in Workiz's fixed order (`salesReportSettings`), with
 * Workiz's key beside ours. `visible` is what the SLK account showed when it
 * was checked live (2026-09-30); `money` columns are withheld without
 * `financials.view`. Every column sorts on the server.
 */
export const SALES_REPORT_COLUMNS = [
  { id: 'jobNumber', label: 'Job ID', workiz: 'job_serial', visible: true, money: false },
  { id: 'jobName', label: 'Job name', workiz: 'job_name', visible: false, money: false },
  { id: 'client', label: 'Client', workiz: 'client_name', visible: true, money: false },
  { id: 'created', label: 'Created', workiz: 'job_created', visible: true, money: false },
  { id: 'scheduled', label: 'Scheduled', workiz: 'job_date', visible: true, money: false },
  { id: 'end', label: 'End', workiz: 'job_end_date', visible: true, money: false },
  { id: 'status', label: 'Status', workiz: 'status', visible: true, money: false },
  { id: 'type', label: 'Job type', workiz: 'job_type', visible: true, money: false },
  { id: 'tech', label: 'Tech', workiz: 'tech_name', visible: false, money: false },
  { id: 'total', label: 'Total', workiz: 'total_price', visible: true, money: true },
  { id: 'subtotal', label: 'Subtotal', workiz: 'sub_total', visible: false, money: true },
  { id: 'itemCost', label: 'Item cost', workiz: 'cost', visible: true, money: true },
  { id: 'laborCost', label: 'Labor cost', workiz: 'labour_cost', visible: true, money: true },
  { id: 'cardExpenses', label: 'Card Expenses', workiz: 'card_expenses', visible: false, money: true },
  { id: 'techExpenses', label: 'Tech expenses', workiz: 'tech_expenses', visible: true, money: true },
  { id: 'paid', label: 'Paid amount', workiz: 'paid_amount', visible: true, money: true },
  { id: 'due', label: 'Due', workiz: 'due', visible: true, money: true },
  { id: 'tax', label: 'Tax', workiz: 'tax_amount', visible: true, money: true },
  { id: 'profit', label: 'Profit', workiz: 'profit', visible: true, money: true },
  { id: 'tip', label: 'Tip', workiz: 'tip_amount', visible: true, money: true },
  { id: 'source', label: 'Source', workiz: 'ad_group', visible: true, money: false },
  { id: 'invoice', label: 'Invoice', workiz: 'invoice_id', visible: true, money: false },
  { id: 'serviceArea', label: 'Metro', workiz: 'metro', visible: true, money: false },
] as const;

export type SalesReportColumnId = (typeof SALES_REPORT_COLUMNS)[number]['id'];

export const SALES_REPORT_COLUMN_IDS: readonly SalesReportColumnId[] = SALES_REPORT_COLUMNS.map((c) => c.id);

export const SALES_REPORT_DEFAULT_COLUMNS: readonly SalesReportColumnId[] = SALES_REPORT_COLUMNS.filter((c) => c.visible).map(
  (c) => c.id,
);

/** The money columns — withheld, and not sortable, without `financials.view`. */
export const SALES_REPORT_MONEY_COLUMNS: readonly SalesReportColumnId[] = SALES_REPORT_COLUMNS.filter((c) => c.money).map(
  (c) => c.id,
);

/** Rows per page the server accepts. Workiz offers 5, 10 (default), 20, 25, 50 and 100. */
export const SALES_REPORT_MAX_PAGE_SIZE = 1000;
/** The longest period one request may cover — "Last year" is the longest preset. */
export const SALES_REPORT_MAX_DAYS = 366;

/**
 * The multi-filter ("Filter results"): OR inside a group, AND between groups.
 * Workiz's groups for this report: Status (no sub-statuses), Team, Job type,
 * Payment status, Source, Service Areas.
 */
export interface SalesReportFilters {
  /** Super-statuses (never `canceled` — no sale has it). */
  status?: string[];
  /** Team — any of these technicians is assigned; the job counts whole. */
  techId?: string[];
  jobTypeId?: string[];
  paymentStatus?: SalesReportPaymentStatus[];
  sourceId?: string[];
  serviceAreaId?: string[];
}

/** A job's money as the report shows it — dollars, rounded to the cent. */
export interface SalesReportMoney {
  total: number;
  subtotal: number;
  itemCost: number;
  laborCost: number;
  cardExpenses: number;
  techExpenses: number;
  paid: number;
  due: number;
  tax: number;
  profit: number;
  tip: number;
}

/** One job. The money fields are absent without `financials.view`. */
export interface SalesReportRow extends Partial<SalesReportMoney> {
  id: string;
  jobNumber: string;
  jobSerial?: number;
  jobName?: string;
  contactId: string;
  client: string;
  clientCompany?: string;
  /** Under the client's name Workiz prints the first of email, phone and company. */
  email?: string;
  /** Withheld without `contacts.view_numbers` (`phoneMasked` says so). */
  phone?: string;
  phoneMasked?: boolean;
  /** ISO instant. */
  createdAt: string;
  /** Account wall clock: `YYYY-MM-DDTHH:MM`, or `YYYY-MM-DD` for an all-day visit. */
  scheduled?: string;
  end?: string;
  superStatus: JobSuperStatus;
  status: string;
  subStatusId?: string;
  subStatus?: string;
  jobTypeId?: string;
  type: string;
  techIds: string[];
  tech: string[];
  sourceId?: string;
  source?: string;
  /** Set when the job has an invoice; the invoice's number is the job's (`jobNumber`). */
  invoiceId?: string;
  serviceAreaId?: string;
  serviceArea?: string;
  /** Profit / Total × 100, two decimals — Workiz's "NN.NN% margin" under Profit. */
  margin?: number;
}

/** Workiz's first, bold row — over every job the filters and the search keep. */
export interface SalesReportTotals extends Partial<SalesReportMoney> {
  /** How many jobs — Workiz's `counter`. */
  jobs: number;
  margin?: number;
}

/** One day of the chart: Σ Total ("Sales") and Σ Profit of the day's jobs. */
export interface SalesReportDay {
  /** `YYYY-MM-DD` on the account's calendar, on the chosen "By:" date. */
  day: string;
  sales: number;
  profit: number;
}

export type SalesReportPagination = JobsReportPagination;

export interface SalesReportPage {
  rows: SalesReportRow[];
  totals: SalesReportTotals;
  /**
   * Every day of the period, empty ones at zero. Workiz's chart takes the
   * filters but not the search; so does this one. Empty without money.
   */
  chart: SalesReportDay[];
  pagination: SalesReportPagination;
  window: { by: SalesReportBy; from: string; to: string };
  sort: { column: SalesReportColumnId; dir: 'asc' | 'desc' };
  /** False when money is withheld from this caller (no `financials.view`). */
  money: boolean;
}

/**
 * Account-wide report settings — Workiz keeps the visible fields per account
 * (`salesReportSettings`). `by` is the "By:" a fresh page opens on.
 */
export interface SalesReportSettings {
  columns: SalesReportColumnId[];
  by: SalesReportBy;
}

export const SALES_REPORT_DEFAULT_SETTINGS: SalesReportSettings = {
  columns: [...SALES_REPORT_DEFAULT_COLUMNS],
  // Workiz opens this report on "By: Job date".
  by: 'scheduled',
};
