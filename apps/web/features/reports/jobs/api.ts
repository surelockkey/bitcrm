import type { JobsReportPage, JobsReportSettings } from "@bitcrm/types";
import { http } from "@/lib/api/http";
import { env } from "@/lib/env";
import { getIdToken } from "@/stores/auth-store";

const BASE = "/deals/report";

/** One server page of the report — rows already named, sorted and paged. */
export function fetchJobsReport(params: string): Promise<JobsReportPage> {
  return http.get<JobsReportPage>(`${BASE}?${params}`);
}

export function fetchJobsReportSettings(): Promise<JobsReportSettings> {
  return http.get<JobsReportSettings>(`${BASE}/settings`);
}

export function saveJobsReportSettings(body: Partial<JobsReportSettings>): Promise<JobsReportSettings> {
  return http.put<JobsReportSettings>(`${BASE}/settings`, body);
}

/**
 * The export: the same query, every row, built and streamed by the server
 * as CSV. It needs the Bearer header, which a plain link cannot send — so
 * it is fetched and handed back as a Blob for the page to save.
 */
export async function downloadJobsReportCsv(params: string): Promise<Blob> {
  const res = await fetch(`${env.apiBaseUrl}${BASE}/export?${params}`, {
    headers: { Authorization: `Bearer ${getIdToken() ?? ""}` },
  });
  if (!res.ok) {
    const body: { error?: { message?: string } } | null = await res.json().catch(() => null);
    throw new Error(body?.error?.message ?? `Export failed (${res.status})`);
  }
  return res.blob();
}
