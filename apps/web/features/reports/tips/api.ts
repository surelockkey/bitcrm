import type { TipsReportJobsPage, TipsReportPage } from "@bitcrm/types";
import { http } from "@/lib/api/http";

const BASE = "/deals/report/tips";

/** Every person of the period — the page sorts, searches, pages and exports them itself. */
export function fetchTipsReport(params: string): Promise<TipsReportPage> {
  return http.get<TipsReportPage>(`${BASE}?${params}`);
}

/** One person's jobs of the period, a page at a time — the row opened. */
export function fetchTipsReportJobs(params: string): Promise<TipsReportJobsPage> {
  return http.get<TipsReportJobsPage>(`${BASE}/jobs?${params}`);
}
