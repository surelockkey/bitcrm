import { datePresetRange } from "../lib";
import type { ReportFilters, ReportTab } from "./types";

/**
 * The report's view lives in the URL — the tab, the dates and the "Filter
 * results" picks — so a link opens the same report, and Back steps through
 * what was looked at. Search and page size stay on the page: one is typed a
 * letter at a time, the other is the reader's own habit (remembered locally).
 */

export const REPORT_PATH = "/reports/inventory-usage";

export const REPORT_TABS: { value: ReportTab; label: string }[] = [
  { value: "usage", label: "Inventory Usage" },
  { value: "returns", label: "Returns" },
  { value: "log", label: "Action log" },
];

export type RangePreset = "this_month" | "last_14_days" | "last_30_days" | "last_month" | "custom";

/** Workiz's presets; This month is where the report opens. */
export const RANGE_PRESETS: { value: RangePreset; label: string }[] = [
  { value: "this_month", label: "This month" },
  { value: "last_14_days", label: "Last 14 days" },
  { value: "last_30_days", label: "Last 30 days" },
  { value: "last_month", label: "Last month" },
  { value: "custom", label: "Custom" },
];

export const EMPTY_FILTERS: ReportFilters = {
  techIds: [],
  locationIds: [],
  categories: [],
  brandIds: [],
};

export interface ReportState {
  tab: ReportTab;
  preset: RangePreset;
  /** YYYY-MM-DD, inclusive — derived from the preset unless it is Custom. */
  from: string;
  to: string;
  filters: ReportFilters;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

const shift = (day: string, days: number): string => {
  const d = new Date(`${day}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

/** A preset's days, relative to `today`. "Last N days" includes today, as Workiz's "Recent" does. */
export function presetRange(preset: Exclude<RangePreset, "custom">, today: string): { from: string; to: string } {
  switch (preset) {
    case "last_14_days":
      return { from: shift(today, -13), to: today };
    case "last_30_days":
      return { from: shift(today, -29), to: today };
    case "last_month": {
      const r = datePresetRange("last_month", today);
      return { from: r.from ?? today, to: r.to ?? today };
    }
    default:
      return { from: `${today.slice(0, 7)}-01`, to: today };
  }
}

/** The URL's name for each filter group. */
const FILTER_PARAMS: [keyof ReportFilters, string][] = [
  ["techIds", "tech"],
  ["locationIds", "location"],
  ["categories", "category"],
  ["brandIds", "brand"],
];

const isTab = (v: string | null): v is ReportTab => REPORT_TABS.some((t) => t.value === v);
const isPreset = (v: string | null): v is RangePreset => RANGE_PRESETS.some((p) => p.value === v);

/** What the parser reads — `URLSearchParams`, or Next's read-only one. */
type Params = { get(key: string): string | null; getAll(key: string): string[] };

const values = (params: Params, key: string): string[] =>
  [...new Set(params.getAll(key).map((v) => v.trim()).filter(Boolean))];

/** The view a URL asks for. Anything missing or malformed falls back to the default — never an open window. */
export function parseReportState(sp: Params, today: string): ReportState {
  const tabParam = sp.get("tab");
  const tab: ReportTab = isTab(tabParam) ? tabParam : "usage";
  const rangeParam = sp.get("range");
  const preset: RangePreset = isPreset(rangeParam) ? rangeParam : "this_month";

  let from: string;
  let to: string;
  if (preset === "custom") {
    const rawFrom = sp.get("from");
    const rawTo = sp.get("to");
    to = rawTo && DAY.test(rawTo) ? rawTo : today;
    from = rawFrom && DAY.test(rawFrom) ? rawFrom : to;
    if (from > to) [from, to] = [to, from];
  } else {
    ({ from, to } = presetRange(preset, today));
  }

  const filters = Object.fromEntries(
    FILTER_PARAMS.map(([field, key]) => [field, values(sp, key)]),
  ) as unknown as ReportFilters;

  return { tab, preset, from, to, filters };
}

/** The address of a view: only what differs from the default, a filter's picks repeated. */
export function reportHref(state: ReportState): string {
  const q = new URLSearchParams();
  if (state.tab !== "usage") q.set("tab", state.tab);
  if (state.preset !== "this_month") q.set("range", state.preset);
  if (state.preset === "custom") {
    q.set("from", state.from);
    q.set("to", state.to);
  }
  for (const [field, key] of FILTER_PARAMS) {
    for (const v of state.filters[field]) q.append(key, v);
  }
  const qs = q.toString();
  return qs ? `${REPORT_PATH}?${qs}` : REPORT_PATH;
}

/** How many picks "Filter results" holds, across its groups. */
export function filterCount(filters: ReportFilters): number {
  return FILTER_PARAMS.reduce((n, [field]) => n + filters[field].length, 0);
}
