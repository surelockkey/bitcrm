import {
  INVOICE_DAYS_DUE,
  INVOICE_DAYS_DUE_LABELS,
  INVOICE_REPORT_STATUSES,
  type InvoiceDaysDue,
  type InvoiceReportStatus,
  type InvoiceReportSummary,
  type InvoiceStatus,
} from "@bitcrm/types";
import type { WzFilterGroup, WzFilterValue } from "@/components/workiz/grouped-filter";
import { workizDateTime, type InvoiceReportParams } from "@/features/reports/billing/lib";
import { money } from "@/features/reports/billing/components/report-bits";

/**
 * The rules of the Invoices list drawn as Workiz draws `/root/invoices/`
 * (pg_invoices_wz_*, notes `docs/import/app-parity-2026-10-08/pg_invoices.md`):
 * the four cards, the "Filter results" groups, the status cell, the columns.
 * The counting is the server's (`GET /billing/invoices/report*`).
 */

// ------------------------------------------------------------ filter results

/** Workiz's filter types, which its chips start with: "status: Overdue", "daysDue: 0-30 days", "sent: Unsent". */
export type InvoiceFilterGroupKey = "status" | "daysDue" | "sent";
export type InvoiceFilterValue = WzFilterValue<InvoiceFilterGroupKey>;

const STATUS_LABELS: Record<InvoiceReportStatus, string> = {
  paid: "Paid",
  partially_paid: "Partially paid",
  due: "Due",
  overdue: "Overdue",
};

const SENT = ["sent", "unsent"] as const;
type SentPick = (typeof SENT)[number];

/**
 * Workiz's groups, in its order (pg_invoices_wz_06_filter_open). Its
 * QUICKBOOKS and SERVICE PLAN groups are left out: BitCRM has neither.
 */
export const INVOICE_FILTER_GROUPS: WzFilterGroup<InvoiceFilterGroupKey>[] = [
  {
    key: "status",
    label: "Status",
    chip: "status",
    options: INVOICE_REPORT_STATUSES.map((s) => ({ value: s, label: STATUS_LABELS[s] })),
  },
  {
    key: "daysDue",
    label: "Days due",
    chip: "daysDue",
    options: INVOICE_DAYS_DUE.map((d) => ({ value: d, label: INVOICE_DAYS_DUE_LABELS[d] })),
  },
  {
    key: "sent",
    label: "Sent",
    chip: "sent",
    options: [
      { value: "sent", label: "Sent" },
      { value: "unsent", label: "Unsent" },
    ],
  },
];

const known = <T extends string>(all: readonly T[], picked: readonly string[] | undefined): T[] =>
  (picked ?? []).filter((v): v is T => (all as readonly string[]).includes(v));

/** The picks → the list's query (OR inside a group, AND between groups); empty groups left out. */
export function invoiceFilterQuery(value: InvoiceFilterValue): Pick<InvoiceReportParams, "statuses" | "daysDue" | "sent"> {
  const statuses = known<InvoiceReportStatus>(INVOICE_REPORT_STATUSES, value.status);
  const daysDue = known<InvoiceDaysDue>(INVOICE_DAYS_DUE, value.daysDue);
  const sent = known<SentPick>(SENT, value.sent);
  return {
    ...(statuses.length && { statuses }),
    ...(daysDue.length && { daysDue }),
    ...(sent.length && { sent }),
  };
}

// ------------------------------------------------------------------- cards

export type InvoiceCard = "due" | "overdue" | "unsent" | "needInvoices";
export const INVOICE_CARDS: readonly InvoiceCard[] = ["due", "overdue", "unsent", "needInvoices"];

type CardFigures = Pick<InvoiceReportSummary, "due" | "overdue" | "unsent" | "needInvoices">;

/**
 * A card's words (Workiz's `renderSections`): the money over "Due from 563
 * invoices", "127 invoices" over "Unsent", "40 jobs" over "Need invoices" —
 * counts as the server sends them, without separators.
 */
export function invoiceCardText(card: InvoiceCard, s: CardFigures | undefined): { value: string; caption: string; label: string } {
  const out = (value: string, caption: string) => ({ value, caption, label: `${value} ${caption}` });
  switch (card) {
    case "due":
      return out(money(s?.due.amount), `Due from ${s?.due.count ?? 0} invoices`);
    case "overdue":
      return out(money(s?.overdue.amount), `Overdue from ${s?.overdue.count ?? 0} invoices`);
    case "unsent":
      return out(`${s?.unsent.count ?? 0} invoices`, "Unsent");
    case "needInvoices":
      return out(`${s?.needInvoices.count ?? 0} jobs`, "Need invoices");
  }
}

/**
 * What a card puts in Filter results — the one chip, replacing the picks, as
 * Workiz's card click does. Need invoices filters nothing: it opens the jobs.
 */
export function invoiceCardFilter(card: InvoiceCard): InvoiceFilterValue | null {
  switch (card) {
    case "due":
      return { status: ["due"] };
    case "overdue":
      return { status: ["overdue"] };
    case "unsent":
      return { sent: ["unsent"] };
    case "needInvoices":
      return null;
  }
}

// ------------------------------------------------------------- status cell

/**
 * Workiz's `span._invStatus` colours (reactCss.css): Paid #9bc91a, Due
 * #f5ad0b, Overdue #e35a36; anything else keeps the cell's #999.
 */
const STATUS_LOOK: Record<InvoiceStatus, { word: string; className: string }> = {
  paid: { word: "Paid", className: "text-[#9bc91a]" },
  due: { word: "Due", className: "text-[#f5ad0b]" },
  overdue: { word: "Overdue", className: "text-wz-error" },
  no_amount: { word: "No amount", className: "text-wz-caption" },
};

/**
 * The Status cell: the coloured word, "sent on Thu Oct 08, 2026 10:34 pm" or
 * "Not sent" under it, and — ours, Workiz shows none — whether something was
 * paid on an invoice still open.
 */
export function invoiceStatusCell(
  figures: { status: InvoiceStatus; balance: number },
  totals: { amountPaid?: number } | undefined,
  sentAt: string | undefined,
): { word: string; className: string; partial: boolean; sent: string } {
  const look = STATUS_LOOK[figures.status] ?? STATUS_LOOK.no_amount;
  const partial = figures.status !== "paid" && (totals?.amountPaid ?? 0) > 0 && figures.balance > 0;
  return { ...look, partial, sent: sentAt ? `sent on ${workizDateTime(sentAt)}` : "Not sent" };
}

// ----------------------------------------------------------------- columns

export type InvoiceColumnId =
  | "number"
  | "name"
  | "client"
  | "created"
  | "subtotal"
  | "tax"
  | "discount"
  | "total"
  | "balance"
  | "status"
  | "job"
  | "jobName";

/**
 * Workiz's columns in order, at react-table's flex widths (100 each, Client
 * 200) as the starting widths the reader can then drag. Workiz's checkbox
 * column is left out: it only feeds bulk actions BitCRM does not have.
 */
export const INVOICE_GRID_COLUMNS: { id: InvoiceColumnId; label: string; width: number }[] = [
  { id: "number", label: "Invoice NO.", width: 100 },
  { id: "name", label: "Invoice Name", width: 100 },
  { id: "client", label: "Client", width: 200 },
  { id: "created", label: "Created", width: 100 },
  { id: "subtotal", label: "Subtotal", width: 100 },
  { id: "tax", label: "Tax", width: 100 },
  { id: "discount", label: "Discount", width: 100 },
  { id: "total", label: "Amount", width: 100 },
  { id: "balance", label: "Due", width: 100 },
  { id: "status", label: "Status", width: 100 },
  { id: "job", label: "Job", width: 100 },
  { id: "jobName", label: "Job name", width: 100 },
];
