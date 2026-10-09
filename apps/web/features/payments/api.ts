import type {
  Contact,
  Invoice,
  JobPaymentLedger,
  OnlinePaymentMethod,
  Payment,
  PaymentRefund,
  PaymentReportPage,
  PaymentReportQuery,
  PaymentReportTotals,
  PaymentSettings,
  PaymentSummary,
} from "@bitcrm/types";
import { http } from "@/lib/api/http";
import { getContactsByIds } from "@/features/clients/api";
import { buildPaymentListQuery, type OfflinePaymentMethod, type PaymentListParams } from "./lib";
import { buildPaymentReportQuery } from "./report";
import type { PaymentSettingsBody } from "./schemas";

const BASE = "/billing";

/** One invoice's ledger: the rows, newest first, and what they add up to. */
export interface InvoiceLedger {
  payments: Payment[];
  summary: PaymentSummary;
}

/** The /payments report page. `summary` covers the whole filtered range, not the page. */
export interface PaymentPage {
  items: Payment[];
  nextCursor?: string;
  summary?: PaymentSummary;
}

/** An offline payment keyed in by staff. Online money arrives through Stripe. */
export interface RecordPaymentBody {
  amount: number;
  method: OfflinePaymentMethod;
  reference?: string;
  note?: string;
  takenAt?: string;
}

export interface RefundBody {
  /** Absent ⇒ refund everything still refundable. */
  amount?: number;
  reason?: string;
  sendReceipt?: boolean;
}

/**
 * Account settings plus whether the workspace's Stripe keys are present. The
 * API never returns a key itself — only this flag.
 */
export interface PaymentSettingsView extends PaymentSettings {
  stripeConfigured?: boolean;
}

export const getInvoicePayments = (invoiceId: string): Promise<InvoiceLedger> =>
  http.get<InvoiceLedger>(`${BASE}/invoices/${invoiceId}/payments`);

export const recordPayment = (invoiceId: string, body: RecordPaymentBody): Promise<Payment> =>
  http.post<Payment>(`${BASE}/invoices/${invoiceId}/payments`, body);

/**
 * The job's ledger (Workiz: payments belong to the job). Works whether or not
 * the job has an invoice; `invoiceId` is set only when it does.
 */
export const getDealPayments = (dealId: string): Promise<JobPaymentLedger> =>
  http.get<JobPaymentLedger>(`${BASE}/deals/${dealId}/payments`);

/** An offline payment on the job itself — no invoice needed. */
export const recordDealPayment = (dealId: string, body: RecordPaymentBody): Promise<Payment> =>
  http.post<Payment>(`${BASE}/deals/${dealId}/payments`, body);

export const refundPayment = (paymentId: string, body: RefundBody): Promise<PaymentRefund> =>
  http.post<PaymentRefund>(`${BASE}/payments/${paymentId}/refund`, body);

/** Re-sends the client their receipt for one payment. */
export const resendReceipt = (paymentId: string): Promise<{ sent: boolean; sentTo?: string }> =>
  http.post<{ sent: boolean; sentTo?: string }>(`${BASE}/payments/${paymentId}/receipt`);

export const listPayments = (params: PaymentListParams = {}): Promise<PaymentPage> =>
  http.get<PaymentPage>(`${BASE}/payments${buildPaymentListQuery(params)}`);

/**
 * Workiz Reports → Payments: one page of lines (payments on their payment
 * date, refunds as negative lines of their own); the first page also carries
 * the whole range's totals.
 */
export const getPaymentReport = (q: PaymentReportQuery): Promise<PaymentReportPage> =>
  http.get<PaymentReportPage>(`${BASE}/payments/report${buildPaymentReportQuery(q)}`);

/** What the Client cell prints under the name: the first phone, else the first email. */
export interface PaymentReportClient {
  phone?: string;
  email?: string;
}

/** A page of the report with its clients' phone / email, by contact id. */
export type PaymentReportPageWithClients = PaymentReportPage & { clients: Record<string, PaymentReportClient> };

/**
 * A page of lines together with its clients (`POST /crm/contacts/by-ids`,
 * which masks the numbers per viewer) — one answer, so a row never grows its
 * phone line after it is on screen. `withClients` false (no `contacts.view`)
 * or a refusal leaves the clients out; the lines stand on their own.
 */
export async function getPaymentReportPage(q: PaymentReportQuery, withClients: boolean): Promise<PaymentReportPageWithClients> {
  const page = await getPaymentReport(q);
  const clients: Record<string, PaymentReportClient> = {};
  const ids = [...new Set(page.items.map((r) => r.contactId).filter(Boolean))];
  if (withClients && ids.length) {
    const found = await getContactsByIds(ids.slice(0, 100)).catch(() => [] as Contact[]);
    for (const c of found ?? []) {
      const phone = c.phones?.[0];
      const email = c.emails?.[0];
      clients[c.id] = { ...(phone && { phone }), ...(email && { email }) };
    }
  }
  return { ...page, clients };
}

export const getPaymentReportTotals = (q: PaymentReportQuery): Promise<PaymentReportTotals> =>
  http.get<PaymentReportTotals>(`${BASE}/payments/report/totals${buildPaymentReportQuery(q)}`);

/** Workiz's CSV (its own columns), answered inside the envelope like Workiz's `csvData`. */
export interface PaymentReportExport {
  filename: string;
  csv: string;
  count: number;
  truncated: boolean;
}

export const exportPaymentReport = (q: PaymentReportQuery): Promise<PaymentReportExport> =>
  http.get<PaymentReportExport>(`${BASE}/payments/report/export${buildPaymentReportQuery(q)}`);

export const getPaymentSettings = (): Promise<PaymentSettingsView> =>
  http.get<PaymentSettingsView>(`${BASE}/payment-settings`);

export const updatePaymentSettings = (body: PaymentSettingsBody): Promise<PaymentSettingsView> =>
  http.put<PaymentSettingsView>(`${BASE}/payment-settings`, body);

/** Workiz "Let client pay with" — `null` falls back to the account settings. */
export const setAllowedMethods = (
  invoiceId: string,
  methods: OnlinePaymentMethod[] | null,
): Promise<Invoice> =>
  http.patch<Invoice>(`${BASE}/invoices/${invoiceId}/allowed-methods`, { methods });
