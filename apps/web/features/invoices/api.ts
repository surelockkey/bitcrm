import type { Invoice, InvoiceView } from "@bitcrm/types";
import { http } from "@/lib/api/http";
import { buildInvoiceListQuery, type InvoiceListParams } from "./lib";
import type { InvoicePatch } from "./schemas";

const BASE = "/billing/invoices";

export interface InvoicePage {
  items: Invoice[];
  nextCursor?: string;
}

export interface InvoiceSummary {
  dueAmount: number;
  dueCount: number;
  overdueAmount: number;
  overdueCount: number;
  unsentCount: number;
  paidAmount: number;
  paidCount: number;
  needsInvoiceCount: number;
}

/** A job with items and no invoice yet. */
export interface JobNeedingInvoice {
  id: string;
  dealNumber: string;
  contactId: string;
  clientName?: string;
  itemCount: number;
  total: number;
  createdAt: string;
}

export const listInvoices = (params: InvoiceListParams = {}): Promise<InvoicePage> =>
  http.get<InvoicePage>(`${BASE}${buildInvoiceListQuery(params)}`);

/** Every page for a filter — per-client lists are short. */
export async function fetchAllInvoices(params: Omit<InvoiceListParams, "cursor"> = {}): Promise<Invoice[]> {
  const out: Invoice[] = [];
  let cursor: string | undefined;
  do {
    const page = await listInvoices({ ...params, limit: params.limit ?? 100, cursor });
    out.push(...page.items);
    cursor = page.nextCursor;
  } while (cursor && out.length < 2000);
  return out;
}

export const getInvoiceSummary = (): Promise<InvoiceSummary> =>
  http.get<InvoiceSummary>(`${BASE}/summary`);

export const getJobsNeedingInvoice = (): Promise<JobNeedingInvoice[]> =>
  http.get<JobNeedingInvoice[]>(`${BASE}/needing-invoice`);

export const getInvoiceByDeal = (dealId: string): Promise<InvoiceView | null> =>
  http.get<InvoiceView | null>(`${BASE}/by-deal/${dealId}`);

export const getInvoice = (id: string): Promise<InvoiceView> =>
  http.get<InvoiceView>(`${BASE}/${id}`);

export const createInvoice = (dealId: string): Promise<InvoiceView> =>
  http.post<InvoiceView>(BASE, { dealId });

export const updateInvoice = (id: string, body: InvoicePatch): Promise<InvoiceView> =>
  http.patch<InvoiceView>(`${BASE}/${id}`, body);

export const markInvoiceSent = (id: string, sent: boolean): Promise<Invoice> =>
  http.post<Invoice>(`${BASE}/${id}/mark-sent`, { sent });

export const deleteInvoice = (id: string): Promise<unknown> => http.delete<unknown>(`${BASE}/${id}`);

export const getInvoicePdfUrl = (id: string, download = false): Promise<{ url: string }> =>
  http.get<{ url: string }>(`${BASE}/${id}/pdf${download ? "?download=1" : ""}`);

export const getInvoiceHtml = (id: string): Promise<{ html: string }> =>
  http.get<{ html: string }>(`${BASE}/${id}/html`);
