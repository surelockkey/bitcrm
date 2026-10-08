import { JobSuperStatus, type JobTagColor } from "@bitcrm/types";
import { superStatusLabel } from "./lib";
import type { JobsListCaps, JobsListState, JobsSort } from "./query-params";

/** The sorts that read as a chip — soonest day first is the default. */
type JobsListSortLabel = Exclude<JobsSort, "none" | "day_asc">;

/**
 * The model behind the jobs page's "Filter results" control — Workiz's
 * react-select with its groups laid out as columns (list_03_filter_open):
 * TECHS, TAGS, JOB TYPE, (RECURRING JOBS), SERVICE AREAS. Ours adds the
 * filters Workiz has no place for, as further columns: STATUS (the closed
 * statuses, which are not tabs), COMPANY, and SORT. The day window and the
 * hours are their own column in the component and their own chips here.
 *
 * Pure, so the rules a dispatcher relies on are pinned by tests: a chosen
 * option leaves the menu, OR inside a group and AND across groups, a chip's
 * × takes off exactly that value, clear-all leaves the Search box alone.
 */

export type FilterGroupId = "tech" | "tag" | "type" | "area" | "status" | "company" | "sort";

export interface FilterCatalogs {
  techs: { id: string; name: string }[];
  tags: { id: string; name: string; color: JobTagColor }[];
  jobTypes: { id: string; name: string }[];
  areas: { name: string }[];
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

/** The orders the SORT column offers; soonest day first is the default and needs no chip. */
export const SORT_LABEL: Record<JobsListSortLabel, string> = {
  day_desc: "Latest day first",
  hour_asc: "Earliest hour first",
  hour_desc: "Latest hour first",
};

/** Workiz's chip prefixes are its filter keys: `user`, `tag`, `type`, `metro`. */
const PREFIX: Record<FilterChipKind, string> = {
  tech: "user",
  tag: "tag",
  type: "type",
  area: "metro",
  status: "status",
  company: "company",
  sort: "sort",
  scheduled: "scheduled",
  hours: "hours",
};

const TITLE: Record<FilterGroupId, string> = {
  tech: "Techs",
  tag: "Tags",
  type: "Job type",
  area: "Service Areas",
  status: "Status",
  company: "Company",
  sort: "Sort",
};

/** Every option of every group, before anything is chosen or typed. */
function allOptions(c: FilterCatalogs): FilterGroup[] {
  const groups: FilterGroup[] = [
    { id: "tech", title: TITLE.tech, options: c.techs.map((t) => ({ group: "tech", value: t.id, label: t.name })) },
    { id: "tag", title: TITLE.tag, options: c.tags.map((t) => ({ group: "tag", value: t.id, label: t.name })) },
    { id: "type", title: TITLE.type, options: c.jobTypes.map((t) => ({ group: "type", value: t.id, label: t.name })) },
    { id: "area", title: TITLE.area, options: c.areas.map((a) => ({ group: "area", value: a.name, label: a.name })) },
    {
      id: "status",
      title: TITLE.status,
      options: CLOSED.map((s) => ({ group: "status" as const, value: s, label: superStatusLabel(s) })),
    },
  ];
  // Only worth a column once there is more than one company.
  if (c.companies.length > 1) {
    groups.push({
      id: "company",
      title: TITLE.company,
      options: c.companies.map((b) => ({ group: "company", value: b.id, label: b.name })),
    });
  }
  groups.push({
    id: "sort",
    title: TITLE.sort,
    options: (Object.keys(SORT_LABEL) as JobsListSortLabel[]).map((s) => ({
      group: "sort" as const,
      value: s,
      label: SORT_LABEL[s],
    })),
  });
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
    case "sort":
      return state.sort === o.value;
  }
}

/**
 * The menu's columns: chosen options left out, the rest narrowed by what is
 * typed into the control (case-insensitive substring), empty columns hidden.
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

/** Add `value` to a group's list — or replace it, while the server takes one per group. */
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
    case "sort":
      return { ...state, sort: option.value as JobsSort };
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

/** The chips the control draws, group by group, in the order the menu lists the groups. */
export function filterChips(state: JobsListState, catalogs: FilterCatalogs): FilterChip[] {
  const chips: FilterChip[] = [];
  const add = (kind: FilterChipKind, value: string, text: string) =>
    chips.push({ key: `${kind}:${value}`, kind, value, label: `${PREFIX[kind]}: ${text}` });
  const name = <T extends { name: string }>(list: T[], match: (t: T) => boolean, fallback: string) =>
    list.find(match)?.name ?? fallback;

  for (const id of state.techIds) add("tech", id, name(catalogs.techs, (t) => t.id === id, id));
  for (const id of state.tagIds) add("tag", id, name(catalogs.tags, (t) => t.id === id, id));
  for (const id of state.jobTypeIds) add("type", id, name(catalogs.jobTypes, (t) => t.id === id, id));
  for (const area of state.serviceAreas) add("area", area, area);
  if (isClosed(state.tab)) add("status", state.tab, superStatusLabel(state.tab));
  for (const id of state.businessProfileIds) add("company", id, name(catalogs.companies, (b) => b.id === id, id));
  if (state.dateFrom) {
    const to = state.dateTo && state.dateTo !== state.dateFrom ? ` – ${shortDay(state.dateTo)}` : "";
    add("scheduled", state.dateFrom, `${shortDay(state.dateFrom)}${to}`);
  }
  if (state.hourFrom || state.hourTo) add("hours", `${state.hourFrom ?? ""}-${state.hourTo ?? ""}`, hoursText(state.hourFrom, state.hourTo));
  if (state.sort !== "none" && state.sort !== "day_asc") add("sort", state.sort, SORT_LABEL[state.sort]);
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
    case "sort":
      return { ...state, sort: "none" };
  }
}

/** The control's clear-all ×: every chip goes; the Search box and Show unpaid jobs stay. */
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
    sort: "none",
  };
}
