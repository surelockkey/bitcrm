import { PaymentTerms, type Invoice, type InvoiceStatus } from "@bitcrm/types";
import { addDaysYmd, formatYmd } from "@/features/billing/dates";
import { toneClasses } from "@/lib/theme/tone";

export const INVOICE_STATUS_META: Record<InvoiceStatus, { label: string; className: string }> = {
  no_amount: {
    label: "No amount",
    className: toneClasses("neutral"),
  },
  due: {
    label: "Due",
    className: toneClasses("warning"),
  },
  overdue: {
    label: "Overdue",
    className: toneClasses("destructive"),
  },
  paid: {
    label: "Paid",
    className: toneClasses("success"),
  },
};

export function invoiceStatusLabel(status: InvoiceStatus): string {
  return INVOICE_STATUS_META[status]?.label ?? status;
}

const TERMS_LABEL: Record<PaymentTerms, string> = {
  [PaymentTerms.CASH]: "Due upon receipt",
  [PaymentTerms.NET_15]: "Net 15",
  [PaymentTerms.NET_30]: "Net 30",
  [PaymentTerms.NET_60]: "Net 60",
  [PaymentTerms.CUSTOM]: "Custom",
};

export function paymentTermsLabel(terms: PaymentTerms | undefined): string {
  return terms ? (TERMS_LABEL[terms] ?? terms) : "—";
}

export const PAYMENT_TERMS_OPTIONS = Object.values(PaymentTerms).map((value) => ({
  value,
  label: TERMS_LABEL[value],
}));

const TERM_DAYS: Partial<Record<PaymentTerms, number>> = {
  [PaymentTerms.CASH]: 0,
  [PaymentTerms.NET_15]: 15,
  [PaymentTerms.NET_30]: 30,
  [PaymentTerms.NET_60]: 60,
};

/** Days until due for fixed terms; `null` for custom (the date is picked). */
export function termDays(terms: PaymentTerms): number | null {
  return TERM_DAYS[terms] ?? null;
}

/**
 * The due date after changing terms or the invoice date: fixed terms count
 * from the invoice date; custom keeps whatever date is set.
 */
export function dueDateForTerms(invoiceDate: string, terms: PaymentTerms, currentDueDate: string): string {
  const days = termDays(terms);
  return days === null ? currentDueDate : addDaysYmd(invoiceDate, days);
}

export function sentLabel(sentAt: string | undefined): string {
  return sentAt ? `Sent ${formatYmd(sentAt)}` : "Unsent";
}

export interface InvoiceListParams {
  status?: InvoiceStatus;
  unsent?: boolean;
  contactId?: string;
  dealId?: string;
  from?: string;
  to?: string;
  limit?: number;
  cursor?: string;
}

export function buildInvoiceListQuery(p: InvoiceListParams): string {
  const q = new URLSearchParams();
  if (p.status) q.set("status", p.status);
  if (p.unsent) q.set("unsent", "true");
  if (p.contactId) q.set("contactId", p.contactId);
  if (p.dealId) q.set("dealId", p.dealId);
  if (p.from) q.set("from", p.from);
  if (p.to) q.set("to", p.to);
  if (p.limit) q.set("limit", String(p.limit));
  if (p.cursor) q.set("cursor", p.cursor);
  const s = q.toString();
  return s ? `?${s}` : "";
}

export const INVOICE_CREATE_BLOCKED = "Add at least one item to the job first";

export function canCreateInvoice(itemCount: number): { allowed: true } | { allowed: false; reason: string } {
  return itemCount > 0 ? { allowed: true } : { allowed: false, reason: INVOICE_CREATE_BLOCKED };
}

export type InvoiceChip = "all" | InvoiceStatus;

export const INVOICE_CHIPS: { value: InvoiceChip; label: string }[] = [
  { value: "all", label: "All" },
  { value: "no_amount", label: "No amount" },
  { value: "due", label: "Due" },
  { value: "overdue", label: "Overdue" },
  { value: "paid", label: "Paid" },
];

/** Client-side mirror of the list filters (used for per-client lists). */
export function filterByInvoiceChip<T extends Pick<Invoice, "status" | "sentAt">>(
  rows: T[],
  chip: InvoiceChip,
  unsentOnly: boolean,
): T[] {
  return rows.filter((r) => (chip === "all" || r.status === chip) && (!unsentOnly || !r.sentAt));
}

/** Run `fn` over ids one after another (bulk create), never in parallel. */
export async function runSequentially(
  ids: string[],
  fn: (id: string) => Promise<unknown>,
  onProgress?: (done: number, total: number) => void,
): Promise<{ succeeded: string[]; failed: { id: string; error: unknown }[] }> {
  const succeeded: string[] = [];
  const failed: { id: string; error: unknown }[] = [];
  for (const [i, id] of ids.entries()) {
    try {
      await fn(id);
      succeeded.push(id);
    } catch (error) {
      failed.push({ id, error });
    }
    onProgress?.(i + 1, ids.length);
  }
  return { succeeded, failed };
}
