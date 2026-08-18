import {
  DealPriority,
  DealStage,
  JobSuperStatus,
  SUPER_STATUS_ORDER,
  TERMINAL_SUPER_STATUSES,
} from "@bitcrm/types";
import type {
  Address,
  Contact,
  CustomFieldDefinition,
  CustomFieldValue,
  Deal,
  DealProduct,
} from "@bitcrm/types";
import { addressInList } from "@/features/clients/lib";
import type { UpdateContactValues } from "@/features/clients/schemas";
import type { UpdateDealValues } from "./schemas";

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

/* ------------------------------------------------------------------- sort */

export type JobSortKey = "day" | "hour";

export interface JobSort {
  key: JobSortKey;
  dir: "asc" | "desc";
}

/**
 * Order jobs by day or by time of day, over the schedule (default) or the
 * created timestamp. Hour sorting compares only the time — 08:00 sorts before
 * 14:00 across different dates (a dispatcher's morning-first view). Jobs
 * missing the key always sink to the bottom, in either direction.
 */
export function sortJobs(
  deals: Deal[],
  sort: JobSort,
  field: "scheduledDate" | "createdAt" = "scheduledDate",
): Deal[] {
  const dayKey = (d: Deal): string => (d[field] ?? "").slice(0, 10);
  const hourKey = (d: Deal): string => {
    if (field === "createdAt") return (d.createdAt ?? "").slice(11, 16);
    const start = d.scheduledTimeSlot?.split("-")[0]?.trim() ?? "";
    return /^\d{2}:\d{2}$/.test(start) ? start : "";
  };
  const key = sort.key === "day" ? dayKey : hourKey;
  const mult = sort.dir === "asc" ? 1 : -1;
  return [...deals].sort((a, b) => {
    const ka = key(a);
    const kb = key(b);
    if (ka === kb) return 0;
    if (!ka) return 1;
    if (!kb) return -1;
    return ka < kb ? -mult : mult;
  });
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

/* ------------------- single-save drafts (one Save button on the job page) --- */

/**
 * Editable snapshot of the details tab. Optional deal fields are held as ""
 * while empty so plain controlled inputs can drive them; `buildDealPatch`
 * turns "" back into `undefined` on save (today's commit semantics).
 */
export interface DealDraft {
  address: Address;
  serviceArea: string;
  jobTypeId: string;
  sourceId: string;
  priority: DealPriority;
  poNumber: string;
  workOrderId: string;
  scheduledDate: string;
  scheduledTimeSlot: string;
  notes: string;
  internalNotes: string;
  /** User-defined field answers, keyed by CustomFieldDefinition id. */
  customFields: Record<string, CustomFieldValue>;
}

/** Editable snapshot of the client card. `email` is the first email only. */
export interface ClientDraft {
  firstName: string;
  lastName: string;
  phones: string[];
  email: string;
}

export function dealDraftFromDeal(d: Deal): DealDraft {
  return {
    address: {
      street: d.address?.street ?? "",
      unit: d.address?.unit ?? "",
      city: d.address?.city ?? "",
      state: d.address?.state ?? "",
      zip: d.address?.zip ?? "",
      lat: d.address?.lat,
      lng: d.address?.lng,
    },
    serviceArea: d.serviceArea ?? "",
    jobTypeId: d.jobTypeId,
    sourceId: d.sourceId ?? "",
    priority: d.priority,
    poNumber: d.poNumber ?? "",
    workOrderId: d.workOrderId ?? "",
    scheduledDate: d.scheduledDate ?? "",
    scheduledTimeSlot: d.scheduledTimeSlot ?? "",
    notes: d.notes ?? "",
    internalNotes: d.internalNotes ?? "",
    customFields: { ...(d.customFields ?? {}) },
  };
}

export function clientDraftFromContact(c: Contact): ClientDraft {
  return {
    firstName: c.firstName,
    lastName: c.lastName,
    phones: c.phones.length ? [...c.phones] : [""],
    email: c.emails[0] ?? "",
  };
}

const sameAddress = (a: Address, b: Address): boolean =>
  a.street === b.street &&
  (a.unit ?? "") === (b.unit ?? "") &&
  a.city === b.city &&
  a.state === b.state &&
  a.zip === b.zip &&
  a.lat === b.lat &&
  a.lng === b.lng;

const sameAnswer = (a: CustomFieldValue, b: CustomFieldValue): boolean => {
  if (Array.isArray(a) || Array.isArray(b)) {
    return (
      Array.isArray(a) &&
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((v, i) => v === b[i])
    );
  }
  return a === b;
};

/** Deep-ish equality over two answer maps (array answers compared elementwise). */
const sameCustomFields = (
  a: Record<string, CustomFieldValue>,
  b: Record<string, CustomFieldValue>,
): boolean => {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) {
    if (!(k in a) || !(k in b)) return false;
    if (!sameAnswer(a[k], b[k])) return false;
  }
  return true;
};

/** Optional string fields where an emptied draft value means "clear it". */
const OPTIONAL_DEAL_FIELDS = [
  "sourceId", "poNumber", "workOrderId", "scheduledDate", "scheduledTimeSlot",
] as const;

/**
 * Diff a draft against the server deal → the PUT patch with only the changed
 * keys, or null when nothing changed. Emptied optional fields patch to
 * `undefined`; notes are trimmed, so whitespace-only edits aren't changes.
 */
export function buildDealPatch(deal: Deal, draft: DealDraft): UpdateDealValues | null {
  const base = dealDraftFromDeal(deal);
  const patch: UpdateDealValues = {};
  let dirty = false;

  if (!sameAddress(draft.address, base.address)) { patch.address = draft.address; dirty = true; }
  if (draft.serviceArea !== base.serviceArea) { patch.serviceArea = draft.serviceArea; dirty = true; }
  if (draft.jobTypeId !== base.jobTypeId) { patch.jobTypeId = draft.jobTypeId; dirty = true; }
  if (draft.priority !== base.priority) { patch.priority = draft.priority; dirty = true; }
  for (const key of OPTIONAL_DEAL_FIELDS) {
    if (draft[key] !== base[key]) { patch[key] = draft[key] || undefined; dirty = true; }
  }
  for (const key of ["notes", "internalNotes"] as const) {
    const next = draft[key].trim();
    if (next !== base[key]) { patch[key] = next; dirty = true; }
  }
  // Custom-field answers ride the same single Save: send the whole current
  // answer map (like `address`) only when something actually changed.
  if (!sameCustomFields(draft.customFields, base.customFields)) {
    patch.customFields = draft.customFields;
    dirty = true;
  }

  return dirty ? patch : null;
}

/**
 * Diff a client draft against the contact → the full PUT body (the endpoint
 * replaces, not merges), or null when clean. A `newAddress` not yet on the
 * client is appended for next time; duplicates (per `addressInList`) aren't.
 * Phones are trimmed with empties dropped; an emptied-out draft keeps the
 * contact's phones. Only the first email is editable — the rest are preserved.
 */
export function buildContactBody(
  c: Contact,
  draft: ClientDraft,
  newAddress?: Address,
): UpdateContactValues | null {
  const phones = draft.phones.map((p) => p.trim()).filter(Boolean);
  const email = draft.email.trim();
  const appendAddress = !!newAddress && !addressInList(newAddress, c.addresses);
  const dirty =
    draft.firstName !== c.firstName ||
    draft.lastName !== c.lastName ||
    JSON.stringify(phones) !== JSON.stringify(c.phones) ||
    email !== (c.emails[0] ?? "");
  if (!dirty && !appendAddress) return null;

  return {
    firstName: draft.firstName.trim(),
    lastName: draft.lastName.trim(),
    phones: phones.length ? phones : c.phones,
    emails: email ? [email, ...c.emails.slice(1)] : c.emails.slice(1),
    addresses: appendAddress && newAddress ? [...c.addresses, newAddress] : c.addresses,
    companyId: c.companyId,
    type: c.type,
    title: c.title,
    notes: c.notes,
  };
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
  /**
   * Inclusive time-of-day window ("HH:MM") matched against the slot start —
   * "the 08:00–12:00 jobs" regardless of date. Slotless deals drop out
   * whenever a bound is set.
   */
  hourFrom?: string;
  hourTo?: string;
  /** Active jobs-list tab — a super-status or the `unscheduled` pseudo-tab. */
  tab?: JobTab;
  /** Inclusive scheduledDate range, `YYYY-MM-DD`. A deal with no date is excluded when set. */
  dateFrom?: string;
  dateTo?: string;
  techId?: string;
  tagId?: string;
  search?: string;
}

/** Flatten a custom-field answer to its searchable string form. */
const customFieldText = (v: CustomFieldValue): string =>
  Array.isArray(v) ? v.join(" ") : String(v);

/** Client-side filtering + search over loaded deals (the server barely filters). */
export function filterDeals(
  deals: Deal[],
  filter: DealFilter,
  contactNames: Map<string, string>,
  customFieldDefs: CustomFieldDefinition[] = [],
): Deal[] {
  const q = (filter.search ?? "").trim().toLowerCase();
  // Job IDs are 6-char letter+digit codes (legacy ones pure digits); strip
  // everything else so "#K4T9ZW" and "k4t9zw" both match the stored code.
  const qAlnum = q.replace(/[^a-z0-9]/g, "");
  // Only searchable definitions contribute their answers to free-text search.
  const searchableFieldIds = customFieldDefs.filter((f) => f.searchable).map((f) => f.id);
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
    if (filter.hourFrom || filter.hourTo) {
      const start = d.scheduledTimeSlot?.split("-")[0]?.trim() ?? "";
      if (!/^\d{2}:\d{2}$/.test(start)) return false;
      if (filter.hourFrom && start < filter.hourFrom) return false;
      if (filter.hourTo && start > filter.hourTo) return false;
    }
    if (filter.techId && !d.assignedTechIds.includes(filter.techId)) return false;
    if (filter.tagId && !d.tagIds.includes(filter.tagId)) return false;
    if (q) {
      const name = (contactNames.get(d.contactId) ?? "").toLowerCase();
      const num = String(d.dealNumber).toLowerCase();
      const matchesNum = qAlnum.length > 0 && num.includes(qAlnum);
      const matchesName = name.includes(q);
      const matchesArea = d.serviceArea.toLowerCase().includes(q);
      const matchesCustomField = searchableFieldIds.some((id) => {
        const v = d.customFields?.[id];
        return v !== undefined && customFieldText(v).toLowerCase().includes(q);
      });
      if (!matchesNum && !matchesName && !matchesArea && !matchesCustomField) return false;
    }
    return true;
  });
}
