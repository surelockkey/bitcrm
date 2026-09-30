"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, Download, Info, MapPin } from "lucide-react";
import {
  TIMESHEET_REPORT_DEFAULT_PAGE_SIZE,
  TIMESHEET_REPORT_PAGE_SIZES,
  type TimeClockLocation,
  type TimesheetReportFilters,
} from "@bitcrm/types";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useEntryJobs, useTimesheetEntries } from "../hooks";
import {
  clockCell,
  dollars,
  entriesCsv,
  entriesParams,
  hhmm,
  mapUrl,
  saveCsv,
  sortEntries,
  type EntrySort,
} from "../lib";

/** Workiz's own words on a running entry's Actions cell. */
export const LOCKED_TOOLTIP =
  "This time entry is currently active and cannot be edited or deleted. Please ask this user to clock out to make changes.";

function ClockCell({ at, loc, label }: { at?: string; loc?: TimeClockLocation; label: string }) {
  if (!at) return null;
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="whitespace-nowrap">{clockCell(at)}</span>
      {loc ? (
        <a
          href={mapUrl(loc)}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`${label} location`}
          title={`${label} location`}
          className="text-muted-foreground hover:text-foreground"
        >
          <MapPin className="size-4" />
        </a>
      ) : null}
    </span>
  );
}

/**
 * An opened row of the report: every entry of that person in the period,
 * as Workiz lists them under the name — Clock in / Clock out with the GPS
 * pin, Hours, Cost, the job, Actions and Notes — with its own page size,
 * sort and Export. A running entry reads "Clocked in (locked)".
 *
 * Workiz's pencil and bin (edit or delete a timesheet) are not here:
 * BitCRM's time clock has no endpoint to change an entry after the fact.
 */
export function TimesheetEntries({
  userId,
  from,
  to,
  filters,
  canSeeJobs,
}: {
  userId: string;
  from: string;
  to: string;
  filters: TimesheetReportFilters;
  canSeeJobs: boolean;
}) {
  const query = useTimesheetEntries(entriesParams(userId, { from, to, filters }), true);
  const data = query.data;
  const dealIds = useMemo(() => (data?.rows ?? []).flatMap((r) => (r.dealId ? [r.dealId] : [])), [data]);
  const jobs = useEntryJobs(dealIds, canSeeJobs).data ?? new Map();
  const [sort, setSort] = useState<{ by: EntrySort; dir: "asc" | "desc" }>({ by: "start", dir: "desc" });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(TIMESHEET_REPORT_DEFAULT_PAGE_SIZE);

  if (query.error) {
    return (
      <p role="alert" className="px-4 py-3 text-sm text-destructive">
        {query.error instanceof Error ? query.error.message : "Could not load the entries."}
      </p>
    );
  }
  if (!data) {
    return (
      <div role="status" aria-label="Loading entries" className="space-y-2 p-3">
        {Array.from({ length: 3 }, (_, i) => (
          <Skeleton key={i} className="h-8 w-full" />
        ))}
      </div>
    );
  }
  if (data.rows.length === 0) {
    return <p className="px-4 py-6 text-center text-base font-semibold">No items found</p>;
  }

  const money = data.money;
  const sorted = sortEntries(data.rows, sort.by, sort.dir, jobs);
  const pages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const current = Math.min(page, pages);
  const start = (current - 1) * pageSize;
  const shown = sorted.slice(start, start + pageSize);

  const onSort = (by: EntrySort) => {
    setSort((cur) => (cur.by === by ? { by, dir: cur.dir === "asc" ? "desc" : "asc" } : { by, dir: "desc" }));
    setPage(1);
  };
  const head = (label: string, by?: EntrySort, className = "") => (
    <th
      scope="col"
      className={`px-3 py-2 text-left font-medium ${className}`}
      aria-sort={by && sort.by === by ? (sort.dir === "asc" ? "ascending" : "descending") : undefined}
    >
      {by ? (
        <button type="button" className="inline-flex items-center gap-1 hover:underline" onClick={() => onSort(by)}>
          {label}
          {sort.by === by ? sort.dir === "asc" ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" /> : null}
        </button>
      ) : (
        label
      )}
    </th>
  );

  return (
    <div className="m-2 rounded-md border bg-background">
      <div className="flex items-center justify-end gap-2 border-b px-3 py-2">
        <select
          aria-label="Entries per page"
          className="h-8 rounded-md border bg-background px-2 text-sm"
          value={pageSize}
          onChange={(e) => {
            setPageSize(Number(e.target.value));
            setPage(1);
          }}
        >
          {TIMESHEET_REPORT_PAGE_SIZES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <Button
          variant="outline"
          size="sm"
          className="h-8 gap-1.5"
          onClick={() => saveCsv(entriesCsv(data, sorted, jobs), `timesheet-${data.name}-${from}_${to}.csv`)}
        >
          <Download className="size-3.5" /> Export
        </Button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[56rem] text-sm">
          <thead className="border-b bg-muted/40">
            <tr>
              {head("Clock in")}
              {head("Clock out")}
              {head("Hours", "hours")}
              {money ? head("Cost", "cost") : null}
              {head("Job", "job")}
              {head("Job name", "jobName")}
              {head("Actions")}
              {head("Notes")}
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => {
              const job = r.dealId ? jobs.get(r.dealId) : undefined;
              return (
                <tr key={r.id} className="border-b last:border-b-0 odd:bg-muted/20">
                  <td className="px-3 py-2">
                    <ClockCell at={r.startedAt} loc={r.startLocation} label="Clock in" />
                  </td>
                  <td className="px-3 py-2">
                    <ClockCell at={r.endedAt} loc={r.endLocation} label="Clock out" />
                  </td>
                  <td className="px-3 py-2 tabular-nums">{hhmm(r.minutes)}</td>
                  {money ? <td className="px-3 py-2 tabular-nums">{dollars(r.cost)}</td> : null}
                  <td className="px-3 py-2">
                    {r.dealId ? (
                      <Link href={`/deals/${r.dealId}`} target="_blank" rel="noopener noreferrer" className="font-mono text-xs text-primary hover:underline">
                        {job?.number ?? "Job"}
                      </Link>
                    ) : null}
                  </td>
                  <td className="px-3 py-2">{job?.name ?? ""}</td>
                  <td className="px-3 py-2">
                    {r.open ? (
                      <span className="inline-flex items-center gap-1 whitespace-nowrap text-muted-foreground">
                        Clocked in (locked)
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <button type="button" aria-label="Why locked" className="text-muted-foreground">
                              <Info className="size-3.5" />
                            </button>
                          </TooltipTrigger>
                          <TooltipContent className="max-w-xs">{LOCKED_TOOLTIP}</TooltipContent>
                        </Tooltip>
                      </span>
                    ) : null}
                  </td>
                  <td className="max-w-[24rem] truncate px-3 py-2" title={r.notes}>
                    {r.notes ?? ""}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 border-t px-3 py-2">
        <span className="text-xs tabular-nums text-muted-foreground">
          Showing {start + 1} to {start + shown.length} of {sorted.length} results
        </span>
        <PageSwitch page={current} pages={pages} onPage={setPage} />
      </div>
    </div>
  );
}

/** Workiz's pager: ‹ Page 1 of 3 › */
export function PageSwitch({ page, pages, onPage }: { page: number; pages: number; onPage: (p: number) => void }) {
  return (
    <nav aria-label="Pages" className="flex items-center gap-2 text-sm">
      <Button variant="ghost" size="icon" className="size-8" aria-label="Previous page" disabled={page <= 1} onClick={() => onPage(page - 1)}>
        <ChevronLeft className="size-4" />
      </Button>
      <span className="tabular-nums">
        Page {page} of {pages}
      </span>
      <Button variant="ghost" size="icon" className="size-8" aria-label="Next page" disabled={page >= pages} onClick={() => onPage(page + 1)}>
        <ChevronRight className="size-4" />
      </Button>
    </nav>
  );
}
