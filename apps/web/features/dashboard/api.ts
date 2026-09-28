import type {
  CallFlowSeries,
  DashboardJobsNow,
  DashboardSales,
  DashboardScoreboard,
  DashboardShares,
  DashboardToday,
  JobsByStatusSeries,
} from "@bitcrm/types";
import { http } from "@/lib/api/http";
import type { CallRecord } from "@/features/calls/lib";

export interface DayWindow {
  from: string;
  to: string;
}

/**
 * Скільки робіт створено кожного дня вікна і в якому вони стані зараз.
 * Сервер тримає відповідь тридцять секунд і сам обмежує вікно 92 днями.
 */
export function getJobsByStatus(window: DayWindow): Promise<JobsByStatusSeries> {
  const q = new URLSearchParams({ ...window });
  return http.get<JobsByStatusSeries>(`/deals/stats/jobs-by-status?${q}`);
}

/*
 * Every other widget. Each route is guarded by its widget's own grant, so a
 * card is only ever mounted for a reader the server will answer.
 */
const windowed =
  <T>(path: string) =>
  (window: DayWindow): Promise<T> =>
    http.get<T>(`${path}?${new URLSearchParams({ ...window })}`);

/** Only with `financials.view` as well — the server refuses anyone else. */
export const getSales = windowed<DashboardSales>("/deals/stats/sales");
export const getTopSources = windowed<DashboardShares>("/deals/stats/top-sources");
export const getTopJobTypes = windowed<DashboardShares>("/deals/stats/top-job-types");
export const getServiceAreas = windowed<DashboardShares>("/deals/stats/service-areas");
export const getTechScoreboard = windowed<DashboardScoreboard>("/deals/stats/tech-scoreboard");
export const getDispatchScoreboard = windowed<DashboardScoreboard>("/deals/stats/dispatch-scoreboard");
export const getTopCallFlows = windowed<CallFlowSeries>("/telephony/calls/stats/top-flows");

/** `day` is the viewer's own calendar day, not the server's. */
export const getToday = (day: string): Promise<DashboardToday> =>
  http.get<DashboardToday>(`/deals/stats/today?${new URLSearchParams({ day })}`);

export const getJobsNow = (): Promise<DashboardJobsNow> => http.get<DashboardJobsNow>("/deals/stats/jobs-now");

/** The newest four calls of the whole log, named and masked as the log is. */
export const getRecentCalls = (): Promise<CallRecord[]> =>
  http.get<CallRecord[]>("/telephony/calls/stats/recent");
