import { JobSuperStatus, type JobTagColor } from "@bitcrm/types";
import { superStatusLabel } from "./lib";
import type { JobsListCaps, JobsListState } from "./query-params";

/**
 * The model behind the jobs page's "Filter results" control — Workiz's
 * react-select with its groups laid out as columns (list_03_filter_open):
 * TECHS, TAGS, JOB TYPE, RECURRING JOBS, SERVICE AREAS. We have no recurring
 * jobs, so that column holds the filters Workiz has no place for: STATUS
 * (the closed statuses, which are not tabs) and COMPANY. The day window and
 * the hours sit under the columns in the component and are chips here.
 *
 * Sorting is not a filter: Workiz sorts by a column header, and so do we
 * (the Scheduled header) — it never shows up as a chip (audit L14).
 *
 * Pure, so the rules a dispatcher relies on are pinned by tests: a chosen
 * option leaves the menu, OR inside a group and AND across groups, a chip's
 * × takes off exactly that value, clear-all leaves the Search box alone.
 */

export type FilterGroupId = "tech" | "tag" | "type" | "status" | "company" | "area";

export interface FilterCatalogs {
  /** In the order to offer them — `orderTechs`. */
  techs: { id: string; name: string }[];
  /** In catalog order (`activeJobTags`: priority, then name). */
  tags: { id: string; name: string; color: JobTagColor }[];
  jobTypes: { id: string; name: string }[];
  /**
   * `filterAreas`. `color` (`#rrggbb`) is the area's Workiz chip colour —
   * absent on an area that has none, which Workiz prints as plain words.
   */
  areas: { name: string; color?: string }[];
  companies: { id: string; name: string }[];
}

export interface FilterOption {
  group: FilterGroupId;
  value: string;
  label: string;
}

export interface FilterGroup {
  id: FilterGroupId;
  title: string;
  options: FilterOption[];
}

export type FilterChipKind = FilterGroupId | "scheduled" | "hours";

export interface FilterChip {
  key: string;
  kind: FilterChipKind;
  value: string;
  label: string;
}

/** The statuses that are not tabs in Workiz — reachable here instead. */
const CLOSED: readonly JobSuperStatus[] = [JobSuperStatus.DONE, JobSuperStatus.CANCELED];

const isClosed = (tab: JobsListState["tab"]): tab is JobSuperStatus =>
  (CLOSED as readonly string[]).includes(tab);

/** Workiz's chip prefixes are its filter keys: `user`, `tag`, `type`, `metro`. */
const PREFIX: Record<FilterChipKind, string> = {
  tech: "user",
  tag: "tag",
  type: "type",
  area: "metro",
  status: "status",
  company: "company",
  scheduled: "scheduled",
  hours: "hours",
};

const TITLE: Record<FilterGroupId, string> = {
  tech: "Techs",
  tag: "Tags",
  type: "Job type",
  status: "Status",
  company: "Company",
  area: "Service Areas",
};

/** Workiz's default metro: no chip already means every area, and its menu does not offer it. */
const DEFAULT_AREA = "all areas";

/**
 * The SERVICE AREAS column: every area the jobs can carry — inactive ones
 * too, as Workiz lists them — but not Workiz's default "All areas", A→Z
 * regardless of case (Workiz: North Carolina, PLATINUM ALL STATES, Platinum_AL…).
 */
export function filterAreas<A extends { name: string }>(areas: A[] | undefined): A[] {
  return (areas ?? [])
    .filter((a) => a.name.trim().toLowerCase() !== DEFAULT_AREA)
    .sort((a, b) => a.name.localeCompare(b.name, "en", { sensitivity: "base" }));
}

/**
 * The TECHS column in Workiz's order: the order people joined the team
 * ("(1) YAKOV SZENDER", "(2) IL - DANIEL SZENDER", …), kept on each
 * technician's profile by the import; the name breaks a tie.
 */
export function orderTechs(
  profiles: { userId: string; createdAt?: string }[],
  nameOf: (id: string) => string,
): { id: string; name: string }[] {
  return profiles
    .map((p) => ({ id: p.userId, name: nameOf(p.userId), at: p.createdAt ?? "" }))
    .sort((a, b) => (a.at === b.at ? a.name.localeCompare(b.name) : a.at < b.at ? -1 : 1))
    .map(({ id, name }) => ({ id, name }));
}

/** Every option of every group, before anything is chosen or typed, in reading order. */
function allOptions(c: FilterCatalogs): FilterGroup[] {
  const groups: FilterGroup[] = [
    { id: "tech", title: TITLE.tech, options: c.techs.map((t) => ({ group: "tech", value: t.id, label: t.name })) },
    { id: "tag", title: TITLE.tag, options: c.tags.map((t) => ({ group: "tag", value: t.id, label: t.name })) },
    { id: "type", title: TITLE.type, options: c.jobTypes.map((t) => ({ group: "type", value: t.id, label: t.name })) },
    {
      id: "status",
      title: TITLE.status,
      options: CLOSED.map((s) => ({ group: "status" as const, value: s, label: superStatusLabel(s) })),
    },
  ];
  // Only worth offering once there is more than one company.
  if (c.companies.length > 1) {
    groups.push({
      id: "company",
      title: TITLE.company,
      options: c.companies.map((b) => ({ group: "company", value: b.id, label: b.name })),
    });
  }
  groups.push({ id: "area", title: TITLE.area, options: c.areas.map((a) => ({ group: "area", value: a.name, label: a.name })) });
  return groups;
}

/** Is this option already a chip? */
function chosen(state: JobsListState, o: FilterOption): boolean {
  switch (o.group) {
    case "tech":
      return state.techIds.includes(o.value);
    case "tag":
      return state.tagIds.includes(o.value);
    case "type":
      return state.jobTypeIds.includes(o.value);
    case "area":
      return state.serviceAreas.includes(o.value);
    case "company":
      return state.businessProfileIds.includes(o.value);
    case "status":
      return state.tab === o.value;
  }
}

/**
 * The menu's groups: chosen options left out, the rest narrowed by what is
 * typed into the control (case-insensitive substring), empty groups hidden.
 */
export function filterGroups(catalogs: FilterCatalogs, state: JobsListState, query: string): FilterGroup[] {
  const q = query.trim().toLowerCase();
  return allOptions(catalogs)
    .map((g) => ({
      ...g,
      options: g.options.filter((o) => !chosen(state, o) && (!q || o.label.toLowerCase().includes(q))),
    }))
    .filter((g) => g.options.length > 0);
}

/** Add `value` to a group's list — or replace it, on a backend taking one value per group. */
const pick = (list: string[], value: string, caps: JobsListCaps): string[] =>
  list.includes(value) ? list : caps.multiValue ? [...list, value] : [value];

export function chooseFilter(state: JobsListState, option: FilterOption, caps: JobsListCaps): JobsListState {
  switch (option.group) {
    case "tech":
      return { ...state, techIds: pick(state.techIds, option.value, caps) };
    case "tag":
      return { ...state, tagIds: pick(state.tagIds, option.value, caps) };
    case "type":
      return { ...state, jobTypeIds: pick(state.jobTypeIds, option.value, caps) };
    case "area":
      return { ...state, serviceAreas: pick(state.serviceAreas, option.value, caps) };
    case "company":
      return { ...state, businessProfileIds: pick(state.businessProfileIds, option.value, caps) };
    case "status":
      return { ...state, tab: option.value as JobSuperStatus };
  }
}

/** "2026-10-08" → "Oct 8". */
function shortDay(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function hoursText(from?: string, to?: string): string {
  if (from && to) return `${from} – ${to}`;
  return from ? `from ${from}` : `until ${to}`;
}

/** The chips the control draws, group by group, in the order the menu reads. */
export function filterChips(state: JobsListState, catalogs: FilterCatalogs): FilterChip[] {
  const chips: FilterChip[] = [];
  const add = (kind: FilterChipKind, value: string, text: string) =>
    chips.push({ key: `${kind}:${value}`, kind, value, label: `${PREFIX[kind]}: ${text}` });
  const name = <T extends { name: string }>(list: T[], match: (t: T) => boolean, fallback: string) =>
    list.find(match)?.name ?? fallback;

  for (const id of state.techIds) add("tech", id, name(catalogs.techs, (t) => t.id === id, id));
  for (const id of state.tagIds) add("tag", id, name(catalogs.tags, (t) => t.id === id, id));
  for (const id of state.jobTypeIds) add("type", id, name(catalogs.jobTypes, (t) => t.id === id, id));
  if (isClosed(state.tab)) add("status", state.tab, superStatusLabel(state.tab));
  for (const id of state.businessProfileIds) add("company", id, name(catalogs.companies, (b) => b.id === id, id));
  for (const area of state.serviceAreas) add("area", area, area);
  if (state.dateFrom) {
    const to = state.dateTo && state.dateTo !== state.dateFrom ? ` – ${shortDay(state.dateTo)}` : "";
    add("scheduled", state.dateFrom, `${shortDay(state.dateFrom)}${to}`);
  }
  if (state.hourFrom || state.hourTo) add("hours", `${state.hourFrom ?? ""}-${state.hourTo ?? ""}`, hoursText(state.hourFrom, state.hourTo));
  return chips;
}

export function removeFilterChip(state: JobsListState, chip: FilterChip): JobsListState {
  const without = (list: string[]) => list.filter((v) => v !== chip.value);
  switch (chip.kind) {
    case "tech":
      return { ...state, techIds: without(state.techIds) };
    case "tag":
      return { ...state, tagIds: without(state.tagIds) };
    case "type":
      return { ...state, jobTypeIds: without(state.jobTypeIds) };
    case "area":
      return { ...state, serviceAreas: without(state.serviceAreas) };
    case "company":
      return { ...state, businessProfileIds: without(state.businessProfileIds) };
    case "status":
      return { ...state, tab: JobSuperStatus.SUBMITTED };
    case "scheduled":
      return { ...state, dateFrom: undefined, dateTo: undefined };
    case "hours":
      return { ...state, hourFrom: undefined, hourTo: undefined };
  }
}

/**
 * The control's clear-all ×: every chip goes; the Search box, Show unpaid
 * jobs and the header's sort stay.
 */
export function clearFilters(state: JobsListState): JobsListState {
  return {
    ...state,
    tab: isClosed(state.tab) ? JobSuperStatus.SUBMITTED : state.tab,
    techIds: [],
    tagIds: [],
    jobTypeIds: [],
    serviceAreas: [],
    businessProfileIds: [],
    dateFrom: undefined,
    dateTo: undefined,
    hourFrom: undefined,
    hourTo: undefined,
  };
}
