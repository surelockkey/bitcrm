"use client";

import { Fragment, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowDown, ArrowUp, ChevronLeft, Download, Play, Search } from "lucide-react";
import { toast } from "sonner";
import {
  TIMESHEET_REPORT_DEFAULT_PAGE_SIZE,
  TIMESHEET_REPORT_PAGE_SIZES,
  type TimesheetReportFilters,
  type TimesheetReportRow,
  type TimesheetReportSort,
} from "@bitcrm/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { DateTimeRangePicker } from "@/components/ui/date-time-range-picker";
import { DAY_END, DAY_START, toIsoInstant, toLocalParts } from "@/lib/date-range";
import { useDebouncedValue } from "@/lib/use-debounced-value";
import { cn } from "@/lib/utils";
import { useDenied, usePermissions } from "@/features/auth/use-permissions";
import { NoAccess } from "@/features/clients/components/contacts-page";
import { useUserMap } from "@/features/deals/hooks";
import { accountToday } from "../../jobs/lib";
import { fetchTimesheetReport } from "../api";
import { useTimesheetReport } from "../hooks";
import {
  DEFAULT_TIMESHEET_PRESET,
  JOB_FILTER_OPTIONS,
  TIMESHEET_PRESETS,
  dollars,
  exportParams,
  hhmm,
  reportParams,
  saveCsv,
  timesheetPresetRange,
  timesheetsCsv,
  type TimesheetPreset,
  type TimesheetReportState,
} from "../lib";
import { PageSwitch, TimesheetEntries } from "./timesheet-entries";
import { TimesheetsFilter, type TimesheetFilterGroup } from "./timesheets-filter";

const personName = (u: { firstName?: string; lastName?: string; email?: string; id: string }) =>
  `${u.firstName ?? ""} ${u.lastName ?? ""}`.trim() || u.email || u.id;

/** Workiz's grey tag beside a name, and the arrow that says which way the person last punched. */
function ClockTag({ clockedIn }: { clockedIn: boolean }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span className="rounded-sm bg-muted-foreground/70 px-1.5 py-0.5 text-[11px] font-medium text-background">
        {clockedIn ? "Clocked In" : "Clocked Out"}
      </span>
      {clockedIn ? (
        <ArrowUp aria-hidden className="size-4" strokeWidth={3} />
      ) : (
        <ArrowDown aria-hidden className="size-4" strokeWidth={3} />
      )}
    </span>
  );
}

/**
 * The Workiz Timesheets report (`/root/timesheet`): who was on the clock in a
 * period — one line per person with Hours, Cost and Jobs, the Total line on
 * top, and each line opening into that person's entries. Workiz's filter
 * (Team, Jobs), its date presets (This week (Mon-Today) first), a name
 * search, ten lines to a page and an Export with Gross Hours and Gross Cost.
 *
 * The server does the arithmetic (`GET /users/timeclock/report`): overlapping
 * entries count once in Hours and twice in Gross Hours, a running entry
 * counts nothing, money needs `financials.view`.
 *
 * Workiz's "Add New" (a timesheet typed in by an admin) is not here: BitCRM's
 * time clock only records punches from the app.
 */
export function TimesheetsReportPage({ today: todayProp }: { today?: string } = {}) {
  const denied = useDenied();
  const { can } = usePermissions();
  const [today] = useState(() => todayProp ?? accountToday());

  const [preset, setPreset] = useState<TimesheetPreset>(DEFAULT_TIMESHEET_PRESET);
  const [custom, setCustom] = useState<{ from: string; to: string }>({ from: today, to: today });
  const range = preset === "custom" ? custom : timesheetPresetRange(preset, today);
  const [filters, setFilters] = useState<TimesheetReportFilters>({});
  const [search, setSearch] = useState("");
  const q = useDebouncedValue(search, 400);
  const [sort, setSort] = useState<{ column: TimesheetReportSort; dir: "asc" | "desc" }>({ column: "name", dir: "desc" });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(TIMESHEET_REPORT_DEFAULT_PAGE_SIZE);
  const [openRows, setOpenRows] = useState<Set<string>>(new Set());
  const [exporting, setExporting] = useState(false);

  const state: TimesheetReportState = { from: range.from, to: range.to, filters, search: q, sort: sort.column, dir: sort.dir, page, pageSize };
  const report = useTimesheetReport(reportParams(state));
  const data = report.data;
  const money = data?.money ?? can("financials");

  const { users } = useUserMap();
  const groups: TimesheetFilterGroup[] = useMemo(
    () => [
      {
        key: "userId",
        label: "Team",
        options: users.map((u) => ({ value: u.id, label: personName(u) })).sort((a, b) => a.label.localeCompare(b.label)),
      },
      { key: "job", label: "Jobs", options: JOB_FILTER_OPTIONS },
    ],
    [users],
  );

  if (denied("reports", "view")) return <NoAccess entity="reports" />;

  const reset = <T,>(set: (v: T) => void) => (v: T) => {
    set(v);
    setPage(1);
    setOpenRows(new Set());
  };

  const onSort = (column: TimesheetReportSort) => {
    setSort((cur) => (cur.column === column ? { column, dir: cur.dir === "asc" ? "desc" : "asc" } : { column, dir: "desc" }));
    setPage(1);
  };

  const toggleRow = (userId: string) =>
    setOpenRows((cur) => {
      const next = new Set(cur);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });

  const exportCsv = async () => {
    setExporting(true);
    try {
      const all = await fetchTimesheetReport(exportParams(state));
      saveCsv(timesheetsCsv(all), `timesheets-${state.from}_${state.to}.csv`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Export failed");
    } finally {
      setExporting(false);
    }
  };

  const headCell = (label: string, column: TimesheetReportSort, className = "") => (
    <th
      scope="col"
      className={cn("px-4 py-3 text-left font-medium", className)}
      aria-sort={sort.column === column ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}
    >
      <button type="button" className="inline-flex items-center gap-1 hover:underline" onClick={() => onSort(column)}>
        {label}
        {sort.column === column ? sort.dir === "asc" ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" /> : null}
      </button>
    </th>
  );
  const columns = money ? 4 : 3;
  const pagination = data?.pagination;

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b px-4 py-3 sm:px-6">
        <Link href="/reports" className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ChevronLeft className="size-4" /> Reports
        </Link>
        <span className="text-muted-foreground">/</span>
        <h1 className="text-lg font-semibold tracking-tight">Timesheets</h1>
      </div>

      {/* Workiz's top band: the filter on the left, the period box on the right. */}
      <div className="flex flex-col gap-3 border-b px-4 py-4 sm:px-6 lg:flex-row lg:items-start">
        <div className="min-w-0 flex-1">
          <TimesheetsFilter groups={groups} filters={filters} onChange={reset(setFilters)} />
        </div>
        <div className="flex w-full flex-col gap-2 rounded-md border p-2 lg:w-[22rem]">
          <select
            aria-label="Date preset"
            className="h-9 rounded-md border bg-transparent px-2 text-sm"
            value={preset}
            onChange={(e) => reset(setPreset)(e.target.value as TimesheetPreset)}
          >
            {TIMESHEET_PRESETS.map((p) => (
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
              setOpenRows(new Set());
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
            onChange={(e) => reset(setPageSize)(Number(e.target.value))}
          >
            {TIMESHEET_REPORT_PAGE_SIZES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <Button variant="outline" size="sm" className="h-9 gap-1.5 bg-background" onClick={() => void exportCsv()} disabled={exporting || !data}>
            <Download className="size-3.5" /> {exporting ? "Exporting…" : "Export"}
          </Button>
        </div>

        {report.error ? (
          <p role="alert" className="text-sm text-destructive">
            {report.error instanceof Error ? report.error.message : "Could not load the report."}
          </p>
        ) : !data ? (
          <div role="status" aria-label="Loading timesheets" className="space-y-2">
            <Skeleton className="h-12 w-full" />
            {Array.from({ length: 5 }, (_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : (
          <>
            <div className={cn("overflow-x-auto rounded-md border bg-background", report.isFetching && "opacity-70")}>
              <table className="w-full min-w-[36rem] text-sm">
                <thead className="border-b-2 bg-muted/40">
                  <tr>
                    {headCell("User", "name", "w-[40%]")}
                    {headCell("Hours", "hours")}
                    {money ? headCell("Cost", "cost") : null}
                    {headCell("Jobs", "jobs")}
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-b bg-muted/20 text-base font-semibold" aria-label="Total">
                    <td className="px-4 py-3">Total:</td>
                    <td className="px-4 py-3 tabular-nums">{hhmm(data.total.minutes)}</td>
                    {money ? <td className="px-4 py-3 tabular-nums">{dollars(data.total.cost)}</td> : null}
                    <td className="px-4 py-3 tabular-nums">{data.total.jobs}</td>
                  </tr>
                  {data.rows.length === 0 ? (
                    <tr>
                      <td colSpan={columns} className="px-4 py-10 text-center text-muted-foreground">
                        No results
                      </td>
                    </tr>
                  ) : (
                    data.rows.map((row: TimesheetReportRow) => {
                      const isOpen = openRows.has(row.userId);
                      return (
                        <Fragment key={row.userId}>
                          <tr className="border-b odd:bg-muted/10">
                            <td className="px-4 py-3">
                              <button
                                type="button"
                                aria-expanded={isOpen}
                                aria-label={`${isOpen ? "Close" : "Open"} ${row.name}`}
                                onClick={() => toggleRow(row.userId)}
                                className="inline-flex min-w-0 items-center gap-2 text-left"
                              >
                                <Play
                                  aria-hidden
                                  className={cn("size-3 shrink-0 fill-current transition-transform", isOpen && "rotate-90")}
                                />
                                <span className="truncate">{row.name}</span>
                                <ClockTag clockedIn={row.clockedIn} />
                              </button>
                            </td>
                            <td className="px-4 py-3 tabular-nums">{hhmm(row.minutes)}</td>
                            {money ? <td className="px-4 py-3 tabular-nums">{dollars(row.cost)}</td> : null}
                            <td className="px-4 py-3 tabular-nums">{row.jobs}</td>
                          </tr>
                          {isOpen ? (
                            <tr className="border-b bg-muted/30">
                              <td colSpan={columns} className="p-0">
                                <TimesheetEntries
                                  userId={row.userId}
                                  from={range.from}
                                  to={range.to}
                                  filters={filters}
                                  canSeeJobs={can("deals")}
                                />
                              </td>
                            </tr>
                          ) : null}
                        </Fragment>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
            {pagination ? (
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs tabular-nums text-muted-foreground">
                  {pagination.total === 0
                    ? "No results"
                    : `Showing ${pagination.from} to ${pagination.to} of ${pagination.total} results`}
                </span>
                <PageSwitch page={pagination.page} pages={pagination.pages} onPage={(p) => { setPage(p); setOpenRows(new Set()); }} />
              </div>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
