"use client";

import { Fragment, useState } from "react";
import Link from "next/link";
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight } from "lucide-react";
import { TIPS_REPORT_JOB_COLUMNS, type TipsReportJobSort, type TipsReportRow } from "@bitcrm/types";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { money, workizDate } from "../../jobs/lib";
import { useTipsReportJobs } from "../hooks";
import { jobsParams, reportParams, type TipsReportState, type TipsSort } from "../lib";

/** A header that sorts: Workiz's first click is ascending, the next descending. */
function SortHeader({
  label,
  active,
  dir,
  onClick,
  className,
}: {
  label: string;
  active: boolean;
  dir: "asc" | "desc";
  onClick: () => void;
  className?: string;
}) {
  return (
    <TableHead className={cn(active && "border-b-2 border-b-foreground", className)}>
      <button
        type="button"
        onClick={onClick}
        aria-label={`Sort by ${label}${active ? `, sorted ${dir === "asc" ? "ascending" : "descending"}` : ""}`}
        className={cn("flex w-full items-center gap-1 font-medium", className?.includes("text-right") ? "justify-end" : "text-left")}
      >
        <span className="truncate">{label}</span>
        {active ? dir === "asc" ? <ArrowUp className="size-3 shrink-0" /> : <ArrowDown className="size-3 shrink-0" /> : null}
      </button>
    </TableHead>
  );
}

/**
 * Workiz's Tips table: Tech, Tip total, Jobs — each header a sort — and a
 * caret on every line that opens the person's jobs of the period right under
 * it (several may be open at once, as in Workiz).
 */
export function TipsReportTable({
  rows,
  money: showMoney,
  sort,
  dir,
  onSort,
  state,
  busy,
}: {
  rows: TipsReportRow[];
  money: boolean;
  sort: TipsSort;
  dir: "asc" | "desc";
  onSort: (column: Exclude<TipsSort, "default">) => void;
  /** The report's query — what an opened line lists the jobs of. */
  state: TipsReportState;
  busy?: boolean;
}) {
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const toggle = (id: string) =>
    setOpen((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const span = showMoney ? 3 : 2;

  return (
    <div className="overflow-x-auto border bg-background" aria-busy={busy || undefined}>
      <Table contained={false} className="table-fixed">
        <colgroup>
          <col style={{ width: "30%" }} />
          {showMoney ? <col style={{ width: "35%" }} /> : null}
          <col />
        </colgroup>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <SortHeader label="Tech" active={sort === "name"} dir={dir} onClick={() => onSort("name")} />
            {showMoney ? <SortHeader label="Tip total" active={sort === "tips"} dir={dir} onClick={() => onSort("tips")} /> : null}
            <SortHeader label="Jobs" active={sort === "jobs"} dir={dir} onClick={() => onSort("jobs")} />
          </TableRow>
        </TableHeader>
        <TableBody className={cn(busy && "opacity-60")}>
          {rows.map((r) => {
            const isOpen = open.has(r.techId);
            return (
              <Fragment key={r.techId}>
                <TableRow className="cursor-pointer" onClick={() => toggle(r.techId)}>
                  <TableCell className="overflow-hidden text-sm">
                    <button
                      type="button"
                      aria-expanded={isOpen}
                      aria-label={`${isOpen ? "Close" : "Open"} the jobs of ${r.name || r.techId}`}
                      className="flex max-w-full items-center gap-2 text-left"
                      onClick={(e) => {
                        e.stopPropagation();
                        toggle(r.techId);
                      }}
                    >
                      <ChevronRight aria-hidden className={cn("size-3.5 shrink-0 transition-transform", isOpen && "rotate-90")} />
                      <span className="truncate">{r.name || <span className="text-muted-foreground">Unknown user</span>}</span>
                    </button>
                  </TableCell>
                  {showMoney ? <TableCell className="text-sm tabular-nums">{money(r.tips ?? 0)}</TableCell> : null}
                  <TableCell className="text-sm tabular-nums">{r.jobs}</TableCell>
                </TableRow>
                {isOpen ? (
                  <TableRow className="hover:bg-transparent">
                    <TableCell colSpan={span} className="bg-muted/20 p-2">
                      <TechJobs key={reportParams(state)} state={state} techId={r.techId} name={r.name} />
                    </TableCell>
                  </TableRow>
                ) : null}
              </Fragment>
            );
          })}
        </TableBody>
      </Table>
      {rows.length === 0 ? <p className="py-10 text-center text-sm text-muted-foreground">No results</p> : null}
    </div>
  );
}

/**
 * The person's jobs of the period, ten at a time from the server: Job ID,
 * Job name, Client, Date, Job type, Total amount (the whole job) and Tip
 * (their share). Every header sorts — Workiz's own Date header breaks its
 * table; this one sorts by the job date.
 */
export function TechJobs({ state, techId, name }: { state: TipsReportState; techId: string; name: string }) {
  const [sort, setSort] = useState<{ column: TipsReportJobSort; dir: "asc" | "desc" }>({ column: "default", dir: "asc" });
  const [page, setPage] = useState(1);
  const q = useTipsReportJobs(jobsParams(state, techId, sort.column, sort.dir, page));
  const data = q.data;
  const showMoney = data?.money ?? true;
  const columns = TIPS_REPORT_JOB_COLUMNS.filter((c) => showMoney || (c.id !== "total" && c.id !== "tip"));

  const onSort = (column: TipsReportJobSort) => {
    setSort((cur) => (cur.column === column ? { column, dir: cur.dir === "asc" ? "desc" : "asc" } : { column, dir: "asc" }));
    setPage(1);
  };

  if (q.error) {
    return (
      <p role="alert" className="px-2 py-3 text-sm text-destructive">
        {q.error instanceof Error ? q.error.message : "Could not load the jobs."}
      </p>
    );
  }
  if (!data) {
    return (
      <div role="status" aria-label={`Loading the jobs of ${name || techId}`} className="space-y-2 p-2">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-8 w-full" />
        ))}
      </div>
    );
  }

  const p = data.pagination;
  return (
    <div className="rounded-sm border bg-background" aria-busy={q.isFetching || undefined}>
      <Table contained={false} aria-label={`Jobs of ${name || techId}`}>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            {columns.map((c) => (
              <SortHeader
                key={c.id}
                label={c.label}
                active={sort.column === c.id}
                dir={sort.dir}
                onClick={() => onSort(c.id)}
              />
            ))}
          </TableRow>
        </TableHeader>
        <TableBody className={cn(q.isFetching && "opacity-60")}>
          {data.rows.map((j) => (
            <TableRow key={j.dealId}>
              <TableCell className="text-sm">
                <Link href={`/deals/${j.dealId}`} target="_blank" rel="noopener noreferrer" className="font-mono text-xs text-primary hover:underline">
                  #{j.jobNumber}
                </Link>
              </TableCell>
              <TableCell className="max-w-[12rem] truncate text-sm">{j.jobName ?? ""}</TableCell>
              <TableCell className="max-w-[14rem] truncate text-sm">
                {j.contactId ? (
                  <Link href={`/contacts/${j.contactId}`} className="text-primary hover:underline">
                    {j.client || "—"}
                  </Link>
                ) : (
                  j.client
                )}
              </TableCell>
              <TableCell className="whitespace-nowrap text-sm">{workizDate(j.date)}</TableCell>
              <TableCell className="max-w-[12rem] truncate text-sm">{j.jobType}</TableCell>
              {showMoney ? <TableCell className="text-sm tabular-nums">{money(j.total ?? 0)}</TableCell> : null}
              {showMoney ? (
                <TableCell className="text-sm tabular-nums" title={j.people > 1 ? `Split between ${j.people} people` : undefined}>
                  {money(j.tip ?? 0)}
                </TableCell>
              ) : null}
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {data.rows.length === 0 ? <p className="py-6 text-center text-sm text-muted-foreground">No jobs</p> : null}
      <div className="flex flex-wrap items-center justify-between gap-2 border-t px-2 py-1.5">
        <span className="text-xs tabular-nums text-muted-foreground">
          {`Showing ${p.from.toLocaleString()} to ${p.to.toLocaleString()} of ${p.total.toLocaleString()} results`}
        </span>
        <nav aria-label="Pages of jobs" className="flex items-center gap-1">
          <Button variant="ghost" size="icon" className="size-7" aria-label="Previous page" disabled={p.page <= 1} onClick={() => setPage(p.page - 1)}>
            <ChevronLeft className="size-4" />
          </Button>
          <span className="text-xs tabular-nums text-muted-foreground">
            Page {p.page} of {p.pages}
          </span>
          <Button variant="ghost" size="icon" className="size-7" aria-label="Next page" disabled={p.page >= p.pages} onClick={() => setPage(p.page + 1)}>
            <ChevronRight className="size-4" />
          </Button>
        </nav>
      </div>
    </div>
  );
}
