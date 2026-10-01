import type { ItemsReportJobsPage, ItemsReportPage } from "@bitcrm/types";
import { http } from "@/lib/api/http";
import { env } from "@/lib/env";
import { getIdToken } from "@/stores/auth-store";

const BASE = "/deals/report/items";

/** One server page of the report — rows grouped, totalled, sorted and paged. */
export function fetchItemsReport(params: string): Promise<ItemsReportPage> {
  return http.get<ItemsReportPage>(`${BASE}?${params}`);
}

/** The jobs of one item (the expanded row). */
export function fetchItemsReportJobs(params: string): Promise<ItemsReportJobsPage> {
  return http.get<ItemsReportJobsPage>(`${BASE}/jobs?${params}`);
}

/**
 * The export: the same query, every row, as Workiz's CSV built by the server.
 * It needs the Bearer header, which a plain link cannot send — so it is
 * fetched and handed back as a Blob for the page to save.
 */
export async function downloadItemsReportCsv(params: string): Promise<Blob> {
  const res = await fetch(`${env.apiBaseUrl}${BASE}/export?${params}`, {
    headers: { Authorization: `Bearer ${getIdToken() ?? ""}` },
  });
  if (!res.ok) {
    const body: { error?: { message?: string } } | null = await res.json().catch(() => null);
    throw new Error(body?.error?.message ?? `Export failed (${res.status})`);
  }
  return res.blob();
}
