import type { TimesheetEntriesPage, TimesheetReportPage } from "@bitcrm/types";
import { http } from "@/lib/api/http";

const BASE = "/users/timeclock/report";

/** One server page of the report — lines already added up, named, sorted and paged. */
export function fetchTimesheetReport(params: string): Promise<TimesheetReportPage> {
  return http.get<TimesheetReportPage>(`${BASE}?${params}`);
}

/** Every entry of one person in the period — the opened row. */
export function fetchTimesheetEntries(params: string): Promise<TimesheetEntriesPage> {
  return http.get<TimesheetEntriesPage>(`${BASE}/entries?${params}`);
}
