"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight, Download, Search } from "lucide-react";
import { toast } from "sonner";
import type { TipsReportFilters } from "@bitcrm/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { DateTimeRangePicker } from "@/components/ui/date-time-range-picker";
import { DAY_END, DAY_START, toIsoInstant, toLocalParts } from "@/lib/date-range";
import { useDebouncedValue } from "@/lib/use-debounced-value";
import { useDenied, usePermissions } from "@/features/auth/use-permissions";
import { NoAccess } from "@/features/clients/components/contacts-page";
import { useUserMap } from "@/features/deals/hooks";
import { useAllTechnicians } from "@/features/technicians/hooks";
import { useJobTypes } from "@/features/job-types/hooks";
import { useContactSearch } from "@/features/clients/hooks";
import { JOBS_REPORT_PRESETS, accountToday, presetRange, type JobsReportPreset } from "../jobs/lib";
import { JobsReportFilter, type FilterGroup, type FilterOption } from "../jobs/components/jobs-report-filter";
import { useTipsReport } from "../tips/hooks";
import {
  TIPS_DEFAULT_PRESET,
  TIPS_REPORT_PAGE_SIZES,
  reportParams,
  searchLines,
  sortLines,
  tipsCsv,
  type TipsReportState,
  type TipsSort,
} from "../tips/lib";
import { TipsReportTable } from "../tips/components/tips-report-table";

const personName = (u: { firstName?: string; lastName?: string; email?: string; id: string }) =>
  `${u.firstName ?? ""} ${u.lastName ?? ""}`.trim() || u.email || u.id;

/**
 * The Workiz Tips report (`/root/tips`): one line a person — Tech, Tip total,
 * Jobs — for the jobs whose JOB DATE falls in the period, any status; a job's
 * tip split equally between everyone on it. A line opens into the person's
 * jobs. Workiz's filter (Tech, Job type, Client), its fifteen date presets
 * (Today first), a search on the name, 10 lines a page and Export.
 *
 * The server sends every person of the period at once (`GET /deals/report/tips`);
 * this page orders, searches, pages and exports them, as Workiz's own table does.
 */
export function TipsReportPage({ today: todayProp }: { today?: string } = {}) {
  const denied = useDenied();
  // The presets count from today on the account's calendar (Eastern), not the viewer's.
  const [today] = useState(() => todayProp ?? accountToday());
  const [preset, setPreset] = useState<JobsReportPreset>(TIPS_DEFAULT_PRESET);
  const [custom, setCustom] = useState<{ from: string; to: string }>({ from: today, to: today });
  const range = preset === "custom" ? custom : presetRange(preset, today);
  const [filters, setFilters] = useState<TipsReportFilters>({});
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<{ column: TipsSort; dir: "asc" | "desc" }>({ column: "default", dir: "asc" });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(10);
  const [exporting, setExporting] = useState(false);

  const state: TipsReportState = { from: range.from, to: range.to, filters };
  const report = useTipsReport(reportParams(state));
  const data = report.data;
  const { users } = useUserMap();
  const filter = useFilterGroups(filters);

  // Workiz's order before a header is clicked: the order the people's accounts were made in.
  const created = useMemo(
    () => new Map(users.filter((u) => typeof (u as { createdAt?: unknown }).createdAt === "string").map((u) => [u.id, (u as { createdAt: string }).createdAt])),
    [users],
  );
  const lines = useMemo(
    () => sortLines(searchLines(data?.rows ?? [], search), sort.column, sort.dir, created),
    [data?.rows, search, sort, created],
  );
  const pages = Math.max(1, Math.ceil(lines.length / pageSize));
  const current = Math.min(page, pages);
  const shown = lines.slice((current - 1) * pageSize, current * pageSize);

  if (denied("reports", "view")) return <NoAccess entity="reports" />;

  const resetPage = <T,>(set: (v: T) => void) => (v: T) => {
    set(v);
    setPage(1);
  };
  const onSort = (column: Exclude<TipsSort, "default">) => {
    setSort((cur) => (cur.column === column ? { column, dir: cur.dir === "asc" ? "desc" : "asc" } : { column, dir: "asc" }));
    setPage(1);
  };

  const exportCsv = () => {
    if (!data) return;
    setExporting(true);
    try {
      const blob = new Blob([tipsCsv(lines, data.money)], { type: "text/csv;charset=utf-8" });
      if (typeof URL.createObjectURL !== "function") return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `tips-report-${state.from}_${state.to}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Export failed");
    } finally {
      setExporting(false);
    }
  };

  const from = lines.length ? (current - 1) * pageSize + 1 : 0;
  const to = (current - 1) * pageSize + shown.length;

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b px-4 py-3 sm:px-6">
        <Link href="/reports" className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ChevronLeft className="size-4" /> Reports
        </Link>
        <span className="text-muted-foreground">/</span>
        <h1 className="text-lg font-semibold tracking-tight">Tips report</h1>
      </div>

      {/* Workiz's top band: the multi-filter, and the period box (no "By:" here — it is always the job date). */}
      <div className="flex flex-col gap-3 border-b px-4 py-4 sm:px-6 lg:flex-row lg:items-start">
        <div className="min-w-0 flex-1">
          <JobsReportFilter<TipsReportFilters>
            groups={filter.groups}
            filters={filters}
            onChange={(next) => {
              filter.remember(next);
              resetPage(setFilters)(next);
            }}
          />
        </div>
        <div className="flex w-full flex-col gap-2 rounded-md border p-2 lg:w-[22rem]">
          <select
            aria-label="Date preset"
            className="h-9 rounded-md border bg-transparent px-2 text-sm"
            value={preset}
            onChange={(e) => resetPage(setPreset)(e.target.value as JobsReportPreset)}
          >
            {JOBS_REPORT_PRESETS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
          <DateTimeRangePicker
            dateOnly
            label="Days"
            value={{ from: toIsoInstant(range.from, DAY_START), to: toIsoInstant(range.to, DAY_END) }}
            onChange={(r) => {
              const from = toLocalParts(r.from)?.date ?? range.from;
              const to = toLocalParts(r.to)?.date ?? from;
              setCustom({ from, to });
              setPreset("custom");
              setPage(1);
            }}
          />
        </div>
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-3 bg-muted/30 px-4 py-4 sm:px-6">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative w-full sm:max-w-sm">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              aria-label="Search"
              className="h-9 bg-background pl-8"
              placeholder="Search"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
            />
          </div>
          <span className="flex-1" />
          <select
            aria-label="Rows per page"
            className="h-9 rounded-md border bg-background px-2 text-sm"
            value={pageSize}
            onChange={(e) => resetPage(setPageSize)(Number(e.target.value))}
          >
            {TIPS_REPORT_PAGE_SIZES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <Button variant="outline" size="sm" className="h-9 gap-1.5 bg-background" onClick={exportCsv} disabled={exporting || !lines.length}>
            <Download className="size-3.5" /> Export
          </Button>
        </div>

        {report.error ? (
          <p role="alert" className="text-sm text-destructive">
            {report.error instanceof Error ? report.error.message : "Could not load the report."}
          </p>
        ) : !data ? (
          <div role="status" aria-label="Loading tips" className="space-y-2">
            <Skeleton className="h-10 w-full" />
            {Array.from({ length: 8 }, (_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : (
          <>
            <TipsReportTable
              rows={shown}
              money={data.money}
              sort={sort.column}
              dir={sort.dir}
              onSort={onSort}
              state={state}
              busy={report.isFetching}
            />
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs tabular-nums text-muted-foreground">
                {`Showing ${from.toLocaleString()} to ${to.toLocaleString()} of ${lines.length.toLocaleString()} results`}
              </span>
              <nav aria-label="Pages" className="flex items-center gap-1">
                <Button variant="outline" size="icon" className="size-8" aria-label="Previous page" disabled={current <= 1} onClick={() => setPage(current - 1)}>
                  <ChevronLeft className="size-4" />
                </Button>
                <span className="px-2 text-xs tabular-nums text-muted-foreground">
                  Page {current} of {pages}
                </span>
                <Button variant="outline" size="icon" className="size-8" aria-label="Next page" disabled={current >= pages} onClick={() => setPage(current + 1)}>
                  <ChevronRight className="size-4" />
                </Button>
              </nav>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/**
 * Workiz's three groups, in its order: Tech (the field team — everyone when
 * the viewer may not list it), Job type, and Client. Workiz offers the first
 * thousand clients of the account; here the group looks clients up as you
 * type in the filter's search, and keeps the names of the ones picked.
 */
function useFilterGroups(filters: TipsReportFilters) {
  const { can } = usePermissions();
  const { users } = useUserMap();
  const { profiles } = useAllTechnicians(can("technicians", "view"));
  const types = useJobTypes().data;
  const [query, setQuery] = useState("");
  const q = useDebouncedValue(query, 300);
  const found = useContactSearch(q, 30);
  const [picked, setPicked] = useState<ReadonlyMap<string, string>>(new Map());

  const clientOptions: FilterOption[] = useMemo(() => {
    const out = new Map<string, string>();
    for (const id of filters.contactId ?? []) out.set(id, picked.get(id) ?? id);
    for (const c of found.data) out.set(c.id, personName(c));
    return [...out].map(([value, label]) => ({ value, label }));
  }, [filters.contactId, picked, found.data]);

  const groups = useMemo(() => {
    const byName = <T extends { label: string }>(a: T, b: T) => a.label.localeCompare(b.label);
    const people = users.map((u) => ({ value: u.id, label: personName(u) })).sort(byName);
    const field = new Set(profiles.map((p) => p.userId));
    const team = field.size ? people.filter((p) => field.has(p.value)) : people;
    return [
      { key: "techId", label: "Tech", options: team },
      { key: "jobTypeId", label: "Job type", options: (types ?? []).map((t) => ({ value: t.id, label: t.name })) },
      {
        key: "contactId",
        label: "Client",
        options: clientOptions,
        remote: true,
        onSearch: setQuery,
        empty: found.tooShort ? "Type to find a client" : found.isLoading ? "Searching…" : "No clients",
      },
    ] satisfies FilterGroup<keyof TipsReportFilters>[];
  }, [users, profiles, types, clientOptions, found.tooShort, found.isLoading]);

  /** Keep the names of the clients picked, so their chips still read after the search moves on. */
  const remember = (next: TipsReportFilters) => {
    const names = new Map(picked);
    for (const o of clientOptions) if (next.contactId?.includes(o.value)) names.set(o.value, o.label);
    setPicked(names);
  };

  return { groups, remember };
}
