import {
  JobSuperStatus,
  type ActivityRow,
  type CallFlowSeries,
  type CallsDashboardBundle,
  type Deal,
  type DealDashboardBundle,
  type DashboardJobsNow,
  type DashboardSales,
  type DashboardScoreboard,
  type DashboardShares,
  type DashboardToday,
  type EstimateReportSummary,
  type InvoiceReportSummary,
  type JobsByStatusSeries,
} from "@bitcrm/types";
import { apiFetchPaginated, http } from "@/lib/api/http";
import type { CallRecord } from "@/features/calls/lib";
import { listDeals } from "@/features/deals/api";
import { personName } from "@/features/deals/person-name";
import { getPaymentReportTotals } from "@/features/payments/api";
import { getEstimateReportSummary, getInvoiceReportSummary } from "@/features/reports/billing/api";
import { getUserNames } from "@/features/users/api";
import { COMING_UP_COUNT, comingUp } from "./coming-up";

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

/*
 * The widgets Workiz Home has beyond the two stats services. Each reads the
 * endpoint its report reads, so the card and the report cannot disagree.
 */

/** "Invoices": the Invoices report's Due and Past due cards (`invoices.view`); no window is All time. */
export const getInvoicesWidget = (window?: DayWindow): Promise<InvoiceReportSummary> =>
  getInvoiceReportSummary({ from: window?.from, to: window?.to });

/** "Estimates": the Estimates report's cards, all time (`estimates.view`). */
export const getEstimatesWidget = (): Promise<EstimateReportSummary> => getEstimateReportSummary({});

export interface ComingUpData {
  /** At most four visits, in start order. */
  deals: Deal[];
  /** The clients' names by contact id, from the list's side-load. */
  clients: Record<string, string>;
}

const shiftDay = (day: string, days: number): string => {
  const d = new Date(`${day}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

/** The statuses a visit is still to come in: not done, not canceled, not awaiting approval. */
const COMING_STATUSES = [JobSuperStatus.SUBMITTED, JobSuperStatus.PENDING, JobSuperStatus.IN_PROGRESS];

/**
 * "Coming up": the first visits from `day` on (the list's 31-day span), one
 * page of four per open status in visit order, merged (`deals.view`).
 */
export async function getComingUp(day: string): Promise<ComingUpData> {
  const pages = await Promise.all(
    COMING_STATUSES.map((superStatus) =>
      listDeals({
        superStatus,
        scheduledFrom: day,
        scheduledTo: shiftDay(day, 30),
        sort: "schedule",
        dir: "asc",
        limit: COMING_UP_COUNT,
      }),
    ),
  );
  const clients: Record<string, string> = {};
  for (const page of pages) {
    for (const c of page.included?.clients ?? []) clients[c.id] = `${c.firstName} ${c.lastName}`.trim();
  }
  return { deals: comingUp(pages.map((p) => p.data)), clients };
}

export interface RecentActivityRow extends ActivityRow {
  /** Who did it, as the Activity report names them. */
  who: string;
}

/**
 * "Recent Activity": the newest three entries of the Activity report's
 * journal over the last month (`reports.view`), each named as the report
 * names it — Workiz's name for an imported event, the directory's otherwise.
 */
export async function getRecentActivity(day: string): Promise<RecentActivityRow[]> {
  const q = new URLSearchParams({ from: shiftDay(day, -30), to: day, limit: "3" });
  const page = await apiFetchPaginated<ActivityRow>(`/deals/activity?${q}`);
  const rows = page.data.slice(0, 3);
  const ours = rows.filter((r) => !r.imported && r.actorId).map((r) => r.actorId);
  const people = ours.length ? await getUserNames([...new Set(ours)]).catch(() => []) : [];
  const byId = new Map(people.map((p) => [p.id, personName(p)]));
  return rows.map((r) => ({ ...r, who: (!r.imported && byId.get(r.actorId)) || r.actorName }));
}

/** "Today → Collected": the Payments report's total for one business day (`payments.view`). */
export const getCollectedToday = async (day: string): Promise<number> =>
  (await getPaymentReportTotals({ from: day, to: day })).amount;

/**
 * A scoreboard's people named the way Workiz names them ("(2) TX - DAVID
 * SZENDER") from the directory's by-ids lookup; a row it cannot name keeps
 * what the server sent.
 */
export async function nameScoreboard(board: DashboardScoreboard): Promise<DashboardScoreboard> {
  const [named] = await nameScoreboards([board]);
  return named;
}

/** Several boards named with one lookup (the opening bundle has two). */
export async function nameScoreboards(boards: (DashboardScoreboard | undefined)[]): Promise<(DashboardScoreboard | undefined)[]> {
  const ids = [...new Set(boards.flatMap((b) => b?.rows.map((r) => r.id) ?? []).filter(Boolean))];
  if (!ids.length) return boards;
  const people = await getUserNames(ids).catch(() => []);
  const byId = new Map(people.map((p) => [p.id, personName(p)]));
  return boards.map((b) => b && { ...b, rows: b.rows.map((r) => ({ ...r, name: byId.get(r.id) || r.name })) });
}
