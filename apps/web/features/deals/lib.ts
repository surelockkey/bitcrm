import {
  DealPriority,
  DealStage,
  JobSuperStatus,
  SUPER_STATUS_ORDER,
  TERMINAL_SUPER_STATUSES,
} from "@bitcrm/types";
import type { Deal, DealProduct } from "@bitcrm/types";

/* ----------------------------------------------------------- super-statuses */

const SUPER_STATUS_LABEL: Record<JobSuperStatus, string> = {
  [JobSuperStatus.SUBMITTED]: "Submitted",
  [JobSuperStatus.IN_PROGRESS]: "In Progress",
  [JobSuperStatus.DONE]: "Done",
  [JobSuperStatus.PENDING]: "Pending",
  [JobSuperStatus.DONE_PENDING_APPROVAL]: "Done Pending Approval",
  [JobSuperStatus.CANCELED]: "Canceled",
};
export const superStatusLabel = (s: JobSuperStatus): string => SUPER_STATUS_LABEL[s] ?? s;

export const isTerminalStatus = (s: JobSuperStatus): boolean => TERMINAL_SUPER_STATUSES.has(s);

/** Tone token per super-status; the badge maps these to colours. */
export type SuperStatusTone =
  | "submitted" | "progress" | "done" | "pending" | "done_pending" | "canceled";
const SUPER_STATUS_TONE: Record<JobSuperStatus, SuperStatusTone> = {
  [JobSuperStatus.SUBMITTED]: "submitted",
  [JobSuperStatus.IN_PROGRESS]: "progress",
  [JobSuperStatus.DONE]: "done",
  [JobSuperStatus.PENDING]: "pending",
  [JobSuperStatus.DONE_PENDING_APPROVAL]: "done_pending",
  [JobSuperStatus.CANCELED]: "canceled",
};
export const superStatusTone = (s: JobSuperStatus): SuperStatusTone =>
  SUPER_STATUS_TONE[s] ?? "submitted";

// The sub-status catalog files each custom status under a super-status, so its
// grouping reuses the same order/labels.
export const GROUP_ORDER = SUPER_STATUS_ORDER;
export const groupLabel = superStatusLabel;

/**
 * Legacy 13-stage labels, kept ONLY so historical `stage_changed` timeline
 * entries still render a readable name. Nothing else should use this.
 */
const STAGE_LABEL: Record<DealStage, string> = {
  [DealStage.NEW_LEAD]: "New Lead",
  [DealStage.ESTIMATE_SENT]: "Estimate Sent",
  [DealStage.APPROVED]: "Approved",
  [DealStage.ASSIGNED]: "Assigned",
  [DealStage.EN_ROUTE]: "En Route",
  [DealStage.ON_SITE]: "On Site",
  [DealStage.WORK_IN_PROGRESS]: "Work In Progress",
  [DealStage.PENDING_PAYMENT]: "Pending Payment",
  [DealStage.PENDING_PARTS]: "Pending Parts",
  [DealStage.FOLLOW_UP]: "Follow Up",
  [DealStage.ON_HOLD]: "On Hold",
  [DealStage.COMPLETED]: "Completed",
  [DealStage.CANCELED]: "Canceled",
};
export const stageLabel = (s: DealStage | undefined): string =>
  s ? STAGE_LABEL[s] ?? s : "—";

/* -------------------------------------------------------------- status tabs */

/**
 * A jobs-list tab: one of the six super-statuses, plus `unscheduled` — a
 * schedule-state pseudo-tab (deals with no `scheduledDate`) that overlaps the
 * status tabs, so an undated Submitted deal shows under both.
 */
export type JobTab = JobSuperStatus | "unscheduled";

export const JOB_TABS: JobTab[] = [...SUPER_STATUS_ORDER, "unscheduled"];

export const jobTabLabel = (t: JobTab): string =>
  t === "unscheduled" ? "Unscheduled" : superStatusLabel(t);

export function matchesTab(d: Pick<Deal, "superStatus" | "scheduledDate">, tab: JobTab): boolean {
  return tab === "unscheduled" ? !d.scheduledDate : d.superStatus === tab;
}

/** Count how many deals fall under each tab. Tabs overlap, so counts sum to ≥ deals.length. */
export function tabCounts(deals: Pick<Deal, "superStatus" | "scheduledDate">[]): Record<JobTab, number> {
  const counts = Object.fromEntries(JOB_TABS.map((t) => [t, 0])) as Record<JobTab, number>;
  for (const d of deals) {
    for (const t of JOB_TABS) if (matchesTab(d, t)) counts[t]++;
  }
  return counts;
}

/* ------------------------------------------------------------------ labels */

// Job types are now a managed catalog — resolve ids to names with
// `useJobTypeName()` / `jobTypeName()` from features/job-types/lib. The old
// hardcoded slug→label map lived here.

export const priorityLabel = (p: DealPriority): string =>
  p === DealPriority.URGENT ? "Urgent" : "Normal";
export const isUrgent = (d: Pick<Deal, "priority">): boolean => d.priority === DealPriority.URGENT;

/* ------------------------------------------------------------------- money */

export function formatMoney(n: number): string {
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export const dealTotal = (products: DealProduct[]): number =>
  products.reduce((sum, p) => sum + p.priceClient * p.quantity, 0);

/** Client-price adjustment band off catalog (story 5.05: ±15%). */
export const PRICE_BAND = 0.15;
export const priceRange = (catalog: number) => ({
  min: catalog * (1 - PRICE_BAND),
  max: catalog * (1 + PRICE_BAND),
});
export function isPriceInBand(price: number, catalog: number): boolean {
  const { min, max } = priceRange(catalog);
  // small epsilon for float edges
  return price >= min - 1e-6 && price <= max + 1e-6;
}

/* ---------------------------------------------------------------- schedule */

export function formatSchedule(date?: string, slot?: string): string {
  if (!date) return "Unscheduled";
  const d = new Date(`${date}T00:00:00`);
  const day = Number.isNaN(d.getTime())
    ? date
    : d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return slot ? `${day} · ${slot}` : day;
}

/**
 * A short, relative label for a scheduled date vs. `todayIso` (date-only), with
 * a tone the table uses to colour it: past → `overdue`, today → `soon`, else `ok`.
 * Returns null for undated deals.
 */
export function scheduleRelative(
  date: string | undefined,
  todayIso: string,
): { label: string; tone: "overdue" | "soon" | "ok" } | null {
  if (!date) return null;
  const day = 86_400_000;
  const diff = Math.round(
    (new Date(`${date}T00:00:00`).getTime() - new Date(`${todayIso}T00:00:00`).getTime()) / day,
  );
  if (Number.isNaN(diff)) return null;
  if (diff < 0) return { label: `${-diff} day${diff === -1 ? "" : "s"} ago`, tone: "overdue" };
  if (diff === 0) return { label: "Today", tone: "soon" };
  if (diff === 1) return { label: "Tomorrow", tone: "ok" };
  return { label: `in ${diff} days`, tone: "ok" };
}

export type DatePreset = "all" | "today" | "week";

const isoDate = (d: Date): string => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};

/** Turn a preset into an inclusive `scheduledDate` range. Week = Mon–Sun containing `todayIso`. */
export function datePresetRange(
  preset: DatePreset,
  todayIso: string,
): { from?: string; to?: string } {
  if (preset === "today") return { from: todayIso, to: todayIso };
  if (preset === "week") {
    const base = new Date(`${todayIso}T00:00:00`);
    const mondayOffset = (base.getDay() + 6) % 7; // days since Monday (0 = Mon)
    const start = new Date(base);
    start.setDate(base.getDate() - mondayOffset);
    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    return { from: isoDate(start), to: isoDate(end) };
  }
  return {};
}

/* ------------------------------------------------------------------ filter */

export interface DealFilter {
  superStatus?: JobSuperStatus;
  priority?: DealPriority;
  jobTypeId?: string;
  sourceId?: string;
  serviceArea?: string;
  /** Keep only deals in one of these super-statuses (empty/undefined = all). */
  statusGroups?: JobSuperStatus[];
  /** Active jobs-list tab — a super-status or the `unscheduled` pseudo-tab. */
  tab?: JobTab;
  /** Inclusive scheduledDate range, `YYYY-MM-DD`. A deal with no date is excluded when set. */
  dateFrom?: string;
  dateTo?: string;
  techId?: string;
  tagId?: string;
  search?: string;
}

/** Client-side filtering + search over loaded deals (the server barely filters). */
export function filterDeals(
  deals: Deal[],
  filter: DealFilter,
  contactNames: Map<string, string>,
): Deal[] {
  const q = (filter.search ?? "").trim().toLowerCase();
  // Job IDs are 6-char letter+digit codes (legacy ones pure digits); strip
  // everything else so "#K4T9ZW" and "k4t9zw" both match the stored code.
  const qAlnum = q.replace(/[^a-z0-9]/g, "");
  return deals.filter((d) => {
    if (filter.superStatus && d.superStatus !== filter.superStatus) return false;
    if (filter.priority && d.priority !== filter.priority) return false;
    if (filter.jobTypeId && d.jobTypeId !== filter.jobTypeId) return false;
    if (filter.sourceId && d.sourceId !== filter.sourceId) return false;
    if (filter.serviceArea && d.serviceArea !== filter.serviceArea) return false;
    if (filter.statusGroups?.length && !filter.statusGroups.includes(d.superStatus))
      return false;
    if (filter.tab && !matchesTab(d, filter.tab)) return false;
    if (filter.dateFrom || filter.dateTo) {
      if (!d.scheduledDate) return false;
      if (filter.dateFrom && d.scheduledDate < filter.dateFrom) return false;
      if (filter.dateTo && d.scheduledDate > filter.dateTo) return false;
    }
    if (filter.techId && !d.assignedTechIds.includes(filter.techId)) return false;
    if (filter.tagId && !d.tagIds.includes(filter.tagId)) return false;
    if (q) {
      const name = (contactNames.get(d.contactId) ?? "").toLowerCase();
      const num = String(d.dealNumber).toLowerCase();
      const matchesNum = qAlnum.length > 0 && num.includes(qAlnum);
      const matchesName = name.includes(q);
      const matchesArea = d.serviceArea.toLowerCase().includes(q);
      if (!matchesNum && !matchesName && !matchesArea) return false;
    }
    return true;
  });
}
