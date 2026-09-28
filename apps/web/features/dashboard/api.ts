import type {
  CallFlowSeries,
  CallsDashboardBundle,
  DealDashboardBundle,
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

/** `refresh` rebuilds the server's snapshot instead of reading the nightly one. */
export interface SnapshotRequest {
  refresh?: boolean;
}

function windowQuery(window: DayWindow, opts?: SnapshotRequest): URLSearchParams {
  const q = new URLSearchParams({ ...window });
  if (opts?.refresh) q.set("refresh", "1");
  return q;
}

/**
 * Скільки робіт створено кожного дня вікна і в якому вони стані зараз.
 * Сервер віддає нічний знімок (computedAt) і сам обмежує вікно 92 днями.
 */
export function getJobsByStatus(window: DayWindow, opts?: SnapshotRequest): Promise<JobsByStatusSeries> {
  return http.get<JobsByStatusSeries>(`/deals/stats/jobs-by-status?${windowQuery(window, opts)}`);
}

/*
 * Every other widget. Each route is guarded by its widget's own grant, so a
 * card is only ever mounted for a reader the server will answer.
 */
const windowed =
  <T>(path: string) =>
  (window: DayWindow, opts?: SnapshotRequest): Promise<T> =>
    http.get<T>(`${path}?${windowQuery(window, opts)}`);

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

/**
 * What the dashboard opens with: every deal widget the reader may see, in one
 * answer. The server leaves out any widget the role does not hold.
 */
export const getDealBundle = (window: DayWindow, day: string): Promise<DealDashboardBundle> =>
  http.get<DealDashboardBundle>(`/deals/stats/dashboard?${new URLSearchParams({ ...window, day })}`);

/** The call widgets, likewise. */
export const getCallsBundle = (window: DayWindow): Promise<CallsDashboardBundle> =>
  http.get<CallsDashboardBundle>(`/telephony/calls/stats/dashboard?${new URLSearchParams({ ...window })}`);
