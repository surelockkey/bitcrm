"use client";

import { Fragment, useState } from "react";
import Link from "next/link";
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import {
  ITEMS_REPORT_COLUMNS,
  type ItemsReportColumnId,
  type ItemsReportRow,
  type ItemsReportSort,
  type ItemsReportTotals,
} from "@bitcrm/types";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { workizDate } from "../../jobs/lib";
import { useItemsReportJobs } from "../hooks";
import { itemJobsParams, itemSubline, marginText, money, unitsText, type ItemsReportState } from "../lib";

/** Where each column starts, in px — Workiz's proportions. */
const WIDTH: Record<ItemsReportColumnId, number> = {
  item: 300,
  model: 160,
  units: 110,
  category: 160,
  price: 130,
  cost: 130,
  profit: 140,
  jobs: 80,
};

const NUMERIC = new Set<ItemsReportColumnId>(["units", "price", "cost", "profit", "jobs"]);

/** Rows of an expanded item per page — Workiz asks 50. */
const JOBS_PAGE_SIZE = 50;

function Figure({ value, margin }: { value?: number; margin?: number }) {
  return (
    <div className="tabular-nums">
      <div>{money(value)}</div>
      {margin !== undefined ? <div className="text-xs text-muted-foreground">{marginText(margin)}</div> : null}
    </div>
  );
}

/**
 * The report grid: Workiz's eight columns, the bold Total row first, a sort
 * on every header, and ▸ on each item to open its jobs underneath.
 */
export function ItemsReportTable({
  rows,
  totals,
  money: showMoney,
  sort,
  dir,
  onSort,
  state,
  busy,
}: {
  rows: ItemsReportRow[];
  totals: ItemsReportTotals;
  money: boolean;
  sort: ItemsReportSort;
  dir: "asc" | "desc";
  onSort: (column: ItemsReportSort) => void;
  /** The report's window and filters — an opened item's jobs are asked over the same. */
  state: ItemsReportState;
  busy?: boolean;
}) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const columns = ITEMS_REPORT_COLUMNS.filter((c) => showMoney || !c.money);
  const toggle = (key: string) =>
    setOpen((cur) => {
      const next = new Set(cur);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  return (
    <div className="overflow-x-auto border bg-background" aria-busy={busy || undefined}>
      <Table contained={false} className="table-fixed" style={{ minWidth: columns.reduce((w, c) => w + WIDTH[c.id], 0) }}>
        <colgroup>
          {columns.map((c) => (
            <col key={c.id} style={{ width: WIDTH[c.id] }} />
          ))}
        </colgroup>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            {columns.map((c) => {
              const active = sort === c.id;
              return (
                <TableHead key={c.id} className={cn(active && "border-b-2 border-b-foreground")}>
                  <button
                    type="button"
                    onClick={() => onSort(c.id)}
                    aria-label={`Sort by ${c.label}${active ? `, sorted ${dir === "asc" ? "ascending" : "descending"}` : ""}`}
                    className={cn("flex w-full items-center gap-1 truncate font-medium", NUMERIC.has(c.id) ? "justify-end" : "text-left")}
                  >
                    <span className="truncate">{c.label}</span>
                    {active ? dir === "asc" ? <ArrowUp className="size-3 shrink-0" /> : <ArrowDown className="size-3 shrink-0" /> : null}
                  </button>
                </TableHead>
              );
            })}
          </TableRow>
        </TableHeader>
        <TableBody className={cn(busy && "opacity-60")}>
          <TableRow aria-label="Total" className="font-semibold">
            {columns.map((c) => (
              <TableCell key={c.id} className={cn("align-top text-sm", NUMERIC.has(c.id) && "text-right")}>
                {c.id === "item" ? (
                  "Total"
                ) : c.id === "units" ? (
                  <span className="tabular-nums">{unitsText(totals.units)}</span>
                ) : c.id === "price" ? (
                  <Figure value={totals.price} />
                ) : c.id === "cost" ? (
                  <Figure value={totals.cost} />
                ) : c.id === "profit" ? (
                  <Figure value={totals.profit} margin={totals.margin} />
                ) : null}
              </TableCell>
            ))}
          </TableRow>
          {rows.map((row) => {
            const expanded = open.has(row.key);
            return (
              <Fragment key={row.key}>
                <TableRow className="align-top">
                  {columns.map((c) => (
                    <TableCell key={c.id} className={cn("overflow-hidden text-sm", NUMERIC.has(c.id) && "text-right")}>
                      {c.id === "item" ? (
                        <div className="flex min-w-0 items-start gap-1.5">
                          <button
                            type="button"
                            aria-expanded={expanded}
                            aria-label={`${expanded ? "Hide" : "Show"} the jobs of ${row.name}`}
                            onClick={() => toggle(row.key)}
                            className="mt-0.5 shrink-0 rounded-sm text-muted-foreground hover:text-foreground"
                          >
                            <ChevronRight className={cn("size-4 transition-transform", expanded && "rotate-90")} />
                          </button>
                          <div className="min-w-0">
                            <div className="truncate" title={row.name}>
                              {row.name || "—"}
                            </div>
                            <div className="truncate text-xs text-muted-foreground">{itemSubline(row)}</div>
                          </div>
                        </div>
                      ) : c.id === "model" ? (
                        <span className="block truncate" title={row.model}>
                          {row.model ?? ""}
                        </span>
                      ) : c.id === "units" ? (
                        <span className="tabular-nums">{unitsText(row.units)}</span>
                      ) : c.id === "category" ? (
                        <span className="block truncate">{row.category ?? ""}</span>
                      ) : c.id === "price" ? (
                        <Figure value={row.price} />
                      ) : c.id === "cost" ? (
                        <Figure value={row.cost} />
                      ) : c.id === "profit" ? (
                        <Figure value={row.profit} margin={row.margin} />
                      ) : (
                        <span className="tabular-nums">{row.jobs}</span>
                      )}
                    </TableCell>
                  ))}
                </TableRow>
                {expanded ? (
                  <TableRow className="hover:bg-transparent">
                    <TableCell colSpan={columns.length} className="bg-background p-2 sm:p-3">
                      <ItemJobs item={row} state={state} money={showMoney} />
                    </TableCell>
                  </TableRow>
                ) : null}
              </Fragment>
            );
          })}
        </TableBody>
      </Table>
      {rows.length === 0 ? <p className="py-10 text-center text-sm text-muted-foreground">No items match the filters.</p> : null}
    </div>
  );
}

/**
 * Workiz's expanded row: the jobs that used the item — Job, Client, Date,
 * Units, Price, Cost, Profit, Service Plan, Sold By — with its own pager.
 */
function ItemJobs({ item, state, money: showMoney }: { item: ItemsReportRow; state: ItemsReportState; money: boolean }) {
  const [page, setPage] = useState(1);
  const query = useItemsReportJobs(itemJobsParams(state, item.key, page, JOBS_PAGE_SIZE), true);
  const data = query.data;

  if (query.error) {
    return (
      <p role="alert" className="text-sm text-destructive">
        {query.error instanceof Error ? query.error.message : "Could not load the jobs."}
      </p>
    );
  }
  if (!data) {
    return (
      <div role="status" aria-label={`Loading the jobs of ${item.name}`} className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> Loading…
      </div>
    );
  }

  const head = ["Job", "Client", "Date", "Units", ...(showMoney ? ["Price", "Cost", "Profit"] : []), "Service Plan", "Sold By"];
  const { pagination } = data;
  return (
    <div className="space-y-2" aria-label={`Jobs of ${item.name}`}>
      <div className="overflow-x-auto border">
        <Table contained={false} className="min-w-[56rem]">
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              {head.map((h) => (
                <TableHead key={h} className={cn("text-xs", ["Units", "Price", "Cost", "Profit"].includes(h) && "text-right")}>
                  {h}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.rows.map((r) => (
              <TableRow key={r.dealId} className="align-top">
                <TableCell className="text-sm">
                  <Link href={`/deals/${r.dealId}`} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                    Job #{r.jobNumber}
                  </Link>
                </TableCell>
                <TableCell className="text-sm">
                  <div className="truncate">{r.client || "—"}</div>
                  {r.clientCompany && r.clientCompany !== r.client ? (
                    <div className="truncate text-xs text-muted-foreground">{r.clientCompany}</div>
                  ) : null}
                </TableCell>
                <TableCell className="text-sm whitespace-nowrap">{workizDate(r.jobDate)}</TableCell>
                <TableCell className="text-right text-sm tabular-nums">{unitsText(r.units)}</TableCell>
                {showMoney ? (
                  <>
                    <TableCell className="text-right text-sm">
                      <Figure value={r.price} />
                    </TableCell>
                    <TableCell className="text-right text-sm">
                      <Figure value={r.cost} />
                    </TableCell>
                    <TableCell className="text-right text-sm">
                      <Figure value={r.profit} margin={r.margin} />
                    </TableCell>
                  </>
                ) : null}
                <TableCell className="text-sm">{r.servicePlan ? "Yes" : "No"}</TableCell>
                <TableCell className="text-sm">{r.soldBy.map((s) => s.name).filter(Boolean).join(", ")}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <span className="tabular-nums">
          {pagination.total === 0 ? "No results" : `Showing ${pagination.from} to ${pagination.to} of ${pagination.total} results`}
        </span>
        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="icon"
            className="size-7"
            aria-label="Previous jobs page"
            disabled={pagination.page <= 1}
            onClick={() => setPage(pagination.page - 1)}
          >
            <ChevronLeft className="size-4" />
          </Button>
          <span className="px-1 tabular-nums">
            Page {pagination.page} of {pagination.pages}
          </span>
          <Button
            variant="outline"
            size="icon"
            className="size-7"
            aria-label="Next jobs page"
            disabled={pagination.page >= pagination.pages}
            onClick={() => setPage(pagination.page + 1)}
          >
            <ChevronRight className="size-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
