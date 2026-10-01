import type { TipsReportFilters, TipsReportJobSort, TipsReportRow } from "@bitcrm/types";
import { jobsReportCsv } from "../lib";

/*
 * The Workiz Tips report, web side: the request it makes of
 * `GET /deals/report/tips`, and what Workiz's table does with the lines —
 * order, search, pages and the CSV. The server sends every person of the
 * period at once (never more than the team), so all of that happens here,
 * as it does in Workiz's own page.
 */

/** Workiz opens its Tips report on today. */
export const TIPS_DEFAULT_PRESET = "today" as const;

/** Workiz's page sizes for the lines; 10 first. */
export const TIPS_REPORT_PAGE_SIZES = [5, 10, 20, 25, 50, 100] as const;

export interface TipsReportState {
  from: string;
  to: string;
  filters: TipsReportFilters;
}

const FILTER_KEYS = ["techId", "jobTypeId", "contactId"] as const satisfies readonly (keyof TipsReportFilters)[];

function baseParams(state: TipsReportState): URLSearchParams {
  const p = new URLSearchParams({ from: state.from, to: state.to });
  for (const key of FILTER_KEYS) {
    const values = state.filters[key];
    if (values?.length) p.set(key, values.join(","));
  }
  return p;
}

export function reportParams(state: TipsReportState): string {
  return baseParams(state).toString();
}

/** One person's jobs: the report's query, plus who, the sort and the page. */
export function jobsParams(
  state: TipsReportState,
  techId: string,
  sort: TipsReportJobSort,
  dir: "asc" | "desc",
  page: number,
): string {
  const p = baseParams(state);
  p.set("tech", techId);
  if (sort !== "default") {
    p.set("sort", sort);
    p.set("dir", dir);
  }
  p.set("page", String(page));
  return p.toString();
}

export const filterCount = (filters: TipsReportFilters): number => FILTER_KEYS.reduce((n, k) => n + (filters[k]?.length ?? 0), 0);

/* ------------------------------------------------------------------ lines */

/** The lines' columns; `default` is Workiz's order before any header is clicked. */
export type TipsSort = "default" | "name" | "tips" | "jobs";

const collator = new Intl.Collator("en", { sensitivity: "base", numeric: true });

/**
 * Workiz lists the people by their user id — the order their accounts were
 * made in. Here: by when the user was created (an imported user keeps
 * Workiz's date), when the viewer may see it; else, and among equals, by name.
 */
function defaultOrder(created: ReadonlyMap<string, string>) {
  return (a: TipsReportRow, b: TipsReportRow): number => {
    const ca = created.get(a.techId);
    const cb = created.get(b.techId);
    if (ca && cb && ca !== cb) return ca < cb ? -1 : 1;
    if (ca && !cb) return -1;
    if (!ca && cb) return 1;
    return collator.compare(a.name, b.name) || (a.techId < b.techId ? -1 : a.techId > b.techId ? 1 : 0);
  };
}

export function sortLines(
  rows: readonly TipsReportRow[],
  sort: TipsSort,
  dir: "asc" | "desc",
  created: ReadonlyMap<string, string> = new Map(),
): TipsReportRow[] {
  const base = defaultOrder(created);
  if (sort === "default") return [...rows].sort(base);
  const sign = dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const c =
      sort === "name" ? collator.compare(a.name, b.name) : sort === "tips" ? (a.tips ?? 0) - (b.tips ?? 0) : a.jobs - b.jobs;
    return c !== 0 ? c * sign : base(a, b);
  });
}

/** Workiz's search box: part of the person's name, any case — it searches nothing else. */
export function searchLines(rows: readonly TipsReportRow[], q: string): TipsReportRow[] {
  const needle = q.trim().toLowerCase();
  return needle ? rows.filter((r) => r.name.toLowerCase().includes(needle)) : [...rows];
}

/* -------------------------------------------------------------------- CSV */

/** A spreadsheet runs a cell starting with `=`, `+`, `-` or `@` as a formula — a name never gets to. */
const defuse = (v: string): string => (/^[=+\-@\t\r]/.test(v) ? `'${v}` : v);

/** The lines as Workiz's table shows them — every line in the order on screen, not just the page. */
export function tipsCsv(rows: readonly TipsReportRow[], money: boolean): string {
  return jobsReportCsv(
    rows.map((r) => ({
      Tech: defuse(r.name || r.techId),
      ...(money && { "Tip total": (r.tips ?? 0).toFixed(2) }),
      Jobs: String(r.jobs),
    })),
  );
}
