import type { SalesReportPage, SalesReportSettings } from "@bitcrm/types";
import { http } from "@/lib/api/http";
import { env } from "@/lib/env";
import { getIdToken } from "@/stores/auth-store";

const BASE = "/deals/report/sales";

/** One server page of the report — rows named, sorted and paged, with the Total row and the chart. */
export function fetchSalesReport(params: string): Promise<SalesReportPage> {
  return http.get<SalesReportPage>(`${BASE}?${params}`);
}

export function fetchSalesReportSettings(): Promise<SalesReportSettings> {
  return http.get<SalesReportSettings>(`${BASE}/settings`);
}

export function saveSalesReportSettings(body: Partial<SalesReportSettings>): Promise<SalesReportSettings> {
  return http.put<SalesReportSettings>(`${BASE}/settings`, body);
}

/**
 * The export: the same query, the Total row and every job, built and
 * streamed by the server as CSV. It needs the Bearer header, which a plain
 * link cannot send — so it is fetched and handed back as a Blob to save.
 */
export async function downloadSalesReportCsv(params: string): Promise<Blob> {
  const res = await fetch(`${env.apiBaseUrl}${BASE}/export?${params}`, {
    headers: { Authorization: `Bearer ${getIdToken() ?? ""}` },
  });
  if (!res.ok) {
    const body: { error?: { message?: string } } | null = await res.json().catch(() => null);
    throw new Error(body?.error?.message ?? `Export failed (${res.status})`);
  }
  return res.blob();
}
