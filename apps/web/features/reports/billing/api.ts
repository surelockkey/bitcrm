import type {
  AgingReport,
  Estimate,
  EstimateReportSummary,
  InvoiceReportRow,
  InvoiceReportSummary,
  ListCount,
  ReportCsvExport,
  TaxReport,
} from "@bitcrm/types";
import { http } from "@/lib/api/http";
import {
  toQuery,
  type AgingParams,
  type EstimateReportParams,
  type InvoiceReportParams,
  type TaxReportParams,
} from "./lib";

/** Workiz's billing reports: Aging invoices, the Invoices / Estimates pages (billing), Tax (deal). */

export const getAging = (p: AgingParams): Promise<AgingReport> =>
  http.get<AgingReport>(`/billing/invoices/aging${toQuery({ ...p })}`);

export const exportAging = (p: AgingParams): Promise<ReportCsvExport> =>
  http.get<ReportCsvExport>(`/billing/invoices/aging/export${toQuery({ ...p, page: undefined, pageSize: undefined })}`);

const invoiceQuery = (p: InvoiceReportParams) =>
  toQuery({
    from: p.from,
    to: p.to,
    statuses: p.statuses,
    daysDue: p.daysDue,
    sent: p.sent,
    search: p.search?.trim(),
    limit: p.limit,
    cursor: p.cursor,
  });

/** Each row carries `report` — Workiz's figures (Subtotal without the card fee, Amount with the tip, the cent rule). */
export const listInvoiceReport = (p: InvoiceReportParams): Promise<{ items: InvoiceReportRow[]; nextCursor?: string }> =>
  http.get(`/billing/invoices/report${invoiceQuery(p)}`);

export const countInvoiceReport = (p: InvoiceReportParams): Promise<ListCount> =>
  http.get<ListCount>(`/billing/invoices/report/count${invoiceQuery({ ...p, cursor: undefined, limit: undefined })}`);

export const getInvoiceReportSummary = (p: Pick<InvoiceReportParams, "from" | "to">): Promise<InvoiceReportSummary> =>
  http.get<InvoiceReportSummary>(`/billing/invoices/report/summary${toQuery({ from: p.from, to: p.to })}`);

export const exportInvoiceReport = (p: InvoiceReportParams): Promise<ReportCsvExport> =>
  http.get<ReportCsvExport>(`/billing/invoices/report/export${invoiceQuery({ ...p, cursor: undefined, limit: undefined })}`);

const estimateQuery = (p: EstimateReportParams) =>
  toQuery({ from: p.from, to: p.to, status: p.status, search: p.search?.trim(), limit: p.limit, cursor: p.cursor });

export const listEstimateReport = (p: EstimateReportParams): Promise<{ items: Estimate[]; nextCursor?: string }> =>
  http.get(`/billing/estimates/report${estimateQuery(p)}`);

export const countEstimateReport = (p: EstimateReportParams): Promise<ListCount> =>
  http.get<ListCount>(`/billing/estimates/report/count${estimateQuery({ ...p, cursor: undefined, limit: undefined })}`);

export const getEstimateReportSummary = (p: Pick<EstimateReportParams, "from" | "to">): Promise<EstimateReportSummary> =>
  http.get<EstimateReportSummary>(`/billing/estimates/report/summary${toQuery({ from: p.from, to: p.to })}`);

export const exportEstimateReport = (p: EstimateReportParams): Promise<ReportCsvExport> =>
  http.get<ReportCsvExport>(`/billing/estimates/report/export${estimateQuery({ ...p, cursor: undefined, limit: undefined })}`);

const taxQuery = (p: TaxReportParams) =>
  toQuery({ basis: p.basis, by: p.basis === "accrual" ? p.by : undefined, from: p.from, to: p.to, tax: p.tax, search: p.search?.trim() });

export const getTaxReport = (p: TaxReportParams): Promise<TaxReport> => http.get<TaxReport>(`/deals/report/tax${taxQuery(p)}`);

export const exportTaxReport = (p: TaxReportParams): Promise<ReportCsvExport> =>
  http.get<ReportCsvExport>(`/deals/report/tax/export${taxQuery(p)}`);
