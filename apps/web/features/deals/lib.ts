import {
  DealPriority,
  DealStage,
  DealStageGroup,
  STAGE_GROUPS,
  TERMINAL_STAGES,
} from "@bitcrm/types";
import type { Deal, DealProduct } from "@bitcrm/types";

/* ------------------------------------------------------------------ stages */

export const STAGE_ORDER: DealStage[] = [
  DealStage.NEW_LEAD,
  DealStage.ESTIMATE_SENT,
  DealStage.APPROVED,
  DealStage.ASSIGNED,
  DealStage.EN_ROUTE,
  DealStage.ON_SITE,
  DealStage.WORK_IN_PROGRESS,
  DealStage.PENDING_PAYMENT,
  DealStage.PENDING_PARTS,
  DealStage.FOLLOW_UP,
  DealStage.ON_HOLD,
  DealStage.COMPLETED,
  DealStage.CANCELED,
];

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
export const stageLabel = (s: DealStage): string => STAGE_LABEL[s] ?? s;

export const stageGroup = (s: DealStage): DealStageGroup => STAGE_GROUPS[s];
export const isTerminal = (s: DealStage): boolean => TERMINAL_STAGES.has(s);

export const GROUP_ORDER: DealStageGroup[] = [
  DealStageGroup.SUBMITTED,
  DealStageGroup.IN_PROGRESS,
  DealStageGroup.PENDING,
  DealStageGroup.CLOSED,
];

const GROUP_LABEL: Record<DealStageGroup, string> = {
  [DealStageGroup.SUBMITTED]: "Submitted",
  [DealStageGroup.IN_PROGRESS]: "In Progress",
  [DealStageGroup.PENDING]: "Pending",
  [DealStageGroup.CLOSED]: "Closed",
};
export const groupLabel = (g: DealStageGroup): string => GROUP_LABEL[g] ?? g;

/** Tailwind-ish token key per group; the badge/board map these to colours. */
export const GROUP_TONE: Record<DealStageGroup, "submitted" | "progress" | "pending" | "closed"> = {
  [DealStageGroup.SUBMITTED]: "submitted",
  [DealStageGroup.IN_PROGRESS]: "progress",
  [DealStageGroup.PENDING]: "pending",
  [DealStageGroup.CLOSED]: "closed",
};
export const stageTone = (s: DealStage) =>
  s === DealStage.CANCELED ? ("canceled" as const) : GROUP_TONE[stageGroup(s)];

/* ------------------------------------------------------------------ labels */

const JOB_TYPE_LABEL: Record<string, string> = {
  lockout: "Lockout",
  rekey: "Rekey",
  lock_change: "Lock Change",
  installation: "Installation",
  repair: "Repair",
  safe: "Safe",
  automotive: "Automotive",
  commercial: "Commercial",
  other: "Other",
};
export function jobTypeLabel(t: string): string {
  if (JOB_TYPE_LABEL[t]) return JOB_TYPE_LABEL[t];
  return t
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(" ");
}

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
  stage?: DealStage;
  priority?: DealPriority;
  jobType?: string;
  serviceArea?: string;
  /** Keep only deals whose stage falls in one of these groups (empty/undefined = all). */
  statusGroups?: DealStageGroup[];
  /** Inclusive scheduledDate range, `YYYY-MM-DD`. A deal with no date is excluded when set. */
  dateFrom?: string;
  dateTo?: string;
  techId?: string;
  tag?: string;
  search?: string;
}

/** Client-side filtering + search over loaded deals (the server barely filters). */
export function filterDeals(
  deals: Deal[],
  filter: DealFilter,
  contactNames: Map<string, string>,
): Deal[] {
  const q = (filter.search ?? "").trim().toLowerCase();
  const qDigits = q.replace(/[^\d]/g, "");
  return deals.filter((d) => {
    if (filter.stage && d.stage !== filter.stage) return false;
    if (filter.priority && d.priority !== filter.priority) return false;
    if (filter.jobType && d.jobType !== filter.jobType) return false;
    if (filter.serviceArea && d.serviceArea !== filter.serviceArea) return false;
    if (filter.statusGroups?.length && !filter.statusGroups.includes(stageGroup(d.stage)))
      return false;
    if (filter.dateFrom || filter.dateTo) {
      if (!d.scheduledDate) return false;
      if (filter.dateFrom && d.scheduledDate < filter.dateFrom) return false;
      if (filter.dateTo && d.scheduledDate > filter.dateTo) return false;
    }
    if (filter.techId && d.assignedTechId !== filter.techId) return false;
    if (filter.tag && !d.tags.includes(filter.tag)) return false;
    if (q) {
      const name = (contactNames.get(d.contactId) ?? "").toLowerCase();
      const num = String(d.dealNumber);
      const matchesNum = qDigits.length > 0 && num.includes(qDigits);
      const matchesName = name.includes(q);
      const matchesArea = d.serviceArea.toLowerCase().includes(q);
      if (!matchesNum && !matchesName && !matchesArea) return false;
    }
    return true;
  });
}
