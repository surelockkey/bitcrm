"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import type { JobsReportColumnId, JobsReportFilters, JobsReportRow } from "@bitcrm/types";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ResizableHead } from "@/components/ui/resizable-head";
import { useColumnWidths } from "@/lib/table/use-column-widths";
import { formatPhone } from "@/features/clients/lib";
import { tagSolidClasses } from "@/features/job-tags/lib";
import { cn } from "@/lib/utils";
import { COLUMN_LABEL, accountWall, money, workizDate, workizStatusLabel } from "../lib";

/*
 * Workiz's Jobs report grid, measured off rep_jobs_wz_01_default /
 * _13_table_right / _14_bottom / _21_one_row / _11_empty_search:
 *
 * - the whole width of the page, a 1px #ddd frame; the header 41px on
 *   #f7f7f7 (14px/500 #404040, 10px in, solid #ccc rules) sticks under the
 *   top bar while the page scrolls; the sorted column carries the 3px bar
 *   (at the foot descending, on top ascending);
 * - react-table's columns: 100px each, Job Created and Lead Created 250px,
 *   all growing alike to fill a wide page; resizable;
 * - cells 20px all round, top-aligned, one line each, clipped;
 * - never shorter than ten rows (react-table `minRows`): blank striped rows.
 */
const WIDTHS: Record<JobsReportColumnId, number> = {
  jobNumber: 100,
  jobName: 100,
  client: 100,
  tags: 100,
  type: 100,
  created: 250,
  scheduled: 100,
  end: 100,
  phone: 100,
  email: 100,
  status: 100,
  tech: 100,
  createdBy: 100,
  address: 100,
  city: 100,
  state: 100,
  zip: 100,
  serviceArea: 100,
  total: 100,
  source: 100,
  externalCompany: 100,
  leadCreated: 250,
  origin: 100,
};

/** The reader's own widths, remembered; v3 since the Workiz widths (v2 held the old ones). */
const WIDTHS_KEY = "jobs-report-v3";

/** react-table's `minRows` on Workiz's report. */
export const MIN_ROWS = 10;

const FRAME = "relative border border-wz-frame";
const TABLE = "table-fixed w-full border-separate border-spacing-0";
const HEAD = "sticky top-0 z-10 h-[42px] border-b border-r border-input bg-muted px-2.5 text-sm leading-[21px] font-medium text-wz-strong";
const CELL = "overflow-hidden border-r border-dotted border-table-border p-5 align-top text-sm leading-4 whitespace-nowrap text-wz-strong";
/**
 * Workiz's `hoverLink`: a value that filters the report when clicked. A value
 * standing straight in its cell ends in "…" (react-table's ellipsis); one
 * Workiz wraps in a block (Status, Tech, Client) runs on into the padding and
 * is cut at the cell's edge — `clip`.
 */
const HOVER_LINK = "cursor-pointer text-left whitespace-nowrap hover:underline";

/** A click on one of these values adds it to the filter, as in Workiz. */
type AddFilter = (key: keyof JobsReportFilters, value: string) => void;

function FilterValue({ onClick, clip = false, children }: { onClick: () => void; clip?: boolean; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick} className={cn(HOVER_LINK, !clip && "max-w-full truncate")}>
      {children}
    </button>
  );
}

function Cell({ row, column, addFilter }: { row: JobsReportRow; column: JobsReportColumnId; addFilter: AddFilter }) {
  switch (column) {
    case "jobNumber":
      // Opens in a tab of its own, so the report and its filters stay put.
      return (
        <Link href={`/deals/${row.id}`} target="_blank" rel="noopener noreferrer" className="block truncate text-foreground hover:underline">
          {row.jobNumber}
        </Link>
      );
    case "jobName":
      return <span className="block truncate">{row.jobName ?? ""}</span>;
    case "client": {
      // Workiz's ClientTableCell: the name (h5 16px/24px #3b4b52), then the
      // number as a blue call link, else the email (12px/18px).
      const under = row.phone ? (
        <a href={`tel:${row.phone}`} className="table text-sm leading-4 whitespace-nowrap text-wz-link no-underline hover:underline">
          {formatPhone(row.phone)}
        </a>
      ) : row.email ? (
        <div className="text-xs leading-[18px] whitespace-nowrap text-foreground">{row.email}</div>
      ) : row.clientCompany && row.clientCompany !== row.client ? (
        <div className="text-xs leading-[18px] whitespace-nowrap text-foreground">{row.clientCompany}</div>
      ) : null;
      return (
        <div>
          {row.contactId ? (
            <Link
              href={`/contacts/${row.contactId}`}
              target="_blank"
              rel="noopener noreferrer"
              className="block text-base leading-6 tracking-[0.2px] whitespace-nowrap text-foreground hover:underline"
            >
              {row.client || "—"}
            </Link>
          ) : (
            <div className="text-base leading-6 tracking-[0.2px] whitespace-nowrap text-foreground">{row.client || "—"}</div>
          )}
          {under}
        </div>
      );
    }
    case "tags":
      // Workiz's `small.tag`: 10px/500 capitals on the tag's colour, 2px
      // corners, 4px sides, 8px in, a row of them 24px apart.
      return (
        <div className="flex flex-wrap gap-y-2.5">
          {row.tags.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => addFilter("tagId", t.id)}
              className={cn(
                "ml-2 h-3.5 shrink-0 cursor-pointer rounded-[2px] px-1 text-[10px] leading-[14px] font-medium whitespace-nowrap uppercase",
                tagSolidClasses(t.color ?? "slate"),
              )}
            >
              {t.name}
            </button>
          ))}
        </div>
      );
    case "type":
      return row.jobTypeId && row.type ? (
        <FilterValue onClick={() => addFilter("jobTypeId", row.jobTypeId!)}>{row.type}</FilterValue>
      ) : (
        <span className="block truncate">{row.type}</span>
      );
    case "created":
      return <span className="block truncate">{workizDate(accountWall(row.createdAt))}</span>;
    case "scheduled":
      return <span className="block truncate">{workizDate(row.scheduled)}</span>;
    case "end":
      return <span className="block truncate">{workizDate(row.end)}</span>;
    case "phone":
      return row.phone ? (
        <a href={`tel:${row.phone}`} className="block truncate text-wz-link no-underline hover:underline">
          {formatPhone(row.phone)}
        </a>
      ) : row.phoneMasked ? (
        <span className="text-xs text-wz-caption">Hidden</span>
      ) : null;
    case "email":
      return <span className="block truncate">{row.email ?? ""}</span>;
    case "status":
      // The status filters; the sub-status is Workiz's `_tblLbl`, 12px #999, 3px under.
      return (
        <div>
          <FilterValue clip onClick={() => addFilter("status", row.superStatus)}>
            {workizStatusLabel(row.superStatus)}
          </FilterValue>
          {row.subStatus ? (
            row.subStatusId ? (
              <button
                type="button"
                onClick={() => addFilter("status", `${row.superStatus}:${row.subStatusId}`)}
                className="mt-[3px] block cursor-pointer text-left text-xs leading-4 whitespace-nowrap text-wz-caption hover:underline"
              >
                {row.subStatus}
              </button>
            ) : (
              <div className="mt-[3px] text-xs leading-4 whitespace-nowrap text-wz-caption">{row.subStatus}</div>
            )
          ) : null}
        </div>
      );
    case "tech":
      return (
        <div className="flex flex-wrap">
          {row.techIds.map((id, i) =>
            row.tech[i] ? (
              <span key={id} className="whitespace-nowrap">
                {i > 0 ? ", " : ""}
                <FilterValue clip onClick={() => addFilter("techId", id)}>
                  {row.tech[i]}
                </FilterValue>
              </span>
            ) : null,
          )}
        </div>
      );
    case "createdBy":
      return row.createdById && row.createdBy ? (
        <FilterValue onClick={() => addFilter("createdBy", row.createdById!)}>{row.createdBy}</FilterValue>
      ) : (
        <span className="block truncate">{row.createdBy}</span>
      );
    case "address":
      return <span className="block truncate">{row.address ?? ""}</span>;
    case "city":
      return <span className="block truncate">{row.city ?? ""}</span>;
    case "state":
      return <span className="block truncate">{row.state ?? ""}</span>;
    case "zip":
      return <span className="block truncate">{row.zip ?? ""}</span>;
    case "serviceArea":
      return row.serviceAreaId && row.serviceArea ? (
        <FilterValue onClick={() => addFilter("serviceAreaId", row.serviceAreaId!)}>{row.serviceArea}</FilterValue>
      ) : (
        <span className="block truncate">{row.serviceArea ?? ""}</span>
      );
    case "total":
      return <span className="block truncate">{money(row.total)}</span>;
    case "source":
      return row.sourceId && row.source ? (
        <FilterValue onClick={() => addFilter("sourceId", row.sourceId!)}>{row.source}</FilterValue>
      ) : null;
    case "externalCompany":
      return row.externalCompanyId && row.externalCompany ? (
        <FilterValue onClick={() => addFilter("externalCompanyId", row.externalCompanyId!)}>{row.externalCompany}</FilterValue>
      ) : null;
    case "leadCreated":
      return <span className="block truncate">{workizDate(accountWall(row.leadCreated))}</span>;
    case "origin":
      return <>{row.origin === "lead" ? "Lead" : "New"}</>;
    default:
      return null;
  }
}

/** The grid's width: every column at its own, and never narrower than the page. */
const gridWidth = (columns: readonly JobsReportColumnId[], widthOf: (id: string) => number) =>
  `max(100%, ${columns.reduce((w, c) => w + widthOf(c), 0)}px)`;

/** Blank striped rows up to `MIN_ROWS` — react-table's `-padRow`, 56px each. */
function PadRows({ count, columns }: { count: number; columns: readonly JobsReportColumnId[] }) {
  return (
    <>
      {Array.from({ length: Math.max(0, count) }, (_, i) => (
        <TableRow key={`pad-${i}`} aria-hidden className="h-14 border-0 hover:bg-transparent">
          {columns.map((c) => (
            <TableCell key={c} className={CELL} />
          ))}
        </TableRow>
      ))}
    </>
  );
}

/**
 * The report grid: the visible columns in Workiz's order, each header a
 * server-side sort, values that Workiz lets you click to filter by. No
 * scroller of its own — the page scrolls both ways, so the header can stick
 * to its top. `viewWidth` is how much of the grid is on screen, where
 * "No Records Found" centres.
 */
export function JobsReportTable({
  rows,
  columns,
  sort,
  dir,
  onSort,
  addFilter,
  busy,
  viewWidth,
}: {
  rows: JobsReportRow[];
  columns: JobsReportColumnId[];
  sort: JobsReportColumnId;
  dir: "asc" | "desc";
  onSort: (column: JobsReportColumnId) => void;
  addFilter: AddFilter;
  busy?: boolean;
  viewWidth?: number;
}) {
  const { widthOf, setWidth, reset } = useColumnWidths(WIDTHS_KEY, WIDTHS);

  return (
    <div className={FRAME} style={{ width: gridWidth(columns, widthOf) }} aria-busy={busy || undefined}>
      <Table contained={false} className={TABLE}>
        <colgroup>
          {columns.map((c) => (
            <col key={c} style={{ width: widthOf(c) }} />
          ))}
        </colgroup>
        <TableHeader>
          <TableRow className="border-0 hover:bg-transparent">
            {columns.map((c) => {
              const label = COLUMN_LABEL.get(c) ?? c;
              const active = sort === c;
              return (
                <ResizableHead
                  key={c}
                  columnId={c}
                  label={label}
                  width={widthOf(c)}
                  onResize={(px) => setWidth(c, px)}
                  onReset={reset}
                  sort={active ? dir : undefined}
                  className={cn(HEAD, "cursor-pointer last:border-r-0")}
                >
                  <button
                    type="button"
                    onClick={() => onSort(c)}
                    aria-label={`Sort by ${label}`}
                    className="block w-full cursor-pointer truncate text-left font-medium"
                  >
                    {label}
                  </button>
                </ResizableHead>
              );
            })}
          </TableRow>
        </TableHeader>
        <TableBody className={cn(busy && "opacity-60")}>
          {rows.map((row) => (
            <TableRow key={row.id} className="border-0 hover:bg-black/5!">
              {columns.map((c) => (
                <TableCell key={c} className={cn(CELL, "last:border-r-0")}>
                  <Cell row={row} column={c} addFilter={addFilter} />
                </TableCell>
              ))}
            </TableRow>
          ))}
          <PadRows count={MIN_ROWS - rows.length} columns={columns} />
        </TableBody>
      </Table>
      {rows.length === 0 ? (
        // Workiz's `.rt-noData`: 15px/500 on a white 70% band, over the blank rows.
        <div className="pointer-events-none absolute inset-x-0 top-[200px] z-[5]">
          <div className="sticky left-0 flex justify-center" style={{ width: viewWidth || "100%" }}>
            <span className="bg-white/70 px-[26px] text-[15px] leading-4 font-medium text-wz-strong">No Records Found</span>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/**
 * The grid while the first page is on its way — Workiz's own loading frame
 * (rep_jobs_wz_00_loading): the header, ten blank striped rows and a small
 * three-dot loader in the middle. Same widths as the grid it turns into.
 */
export function JobsReportTableShell({ columns, viewWidth }: { columns: JobsReportColumnId[]; viewWidth?: number }) {
  const { widthOf } = useColumnWidths(WIDTHS_KEY, WIDTHS);
  return (
    <div role="status" aria-label="Loading jobs" aria-busy className={FRAME} style={{ width: gridWidth(columns, widthOf) }}>
      <Table contained={false} className={TABLE}>
        <colgroup>
          {columns.map((c) => (
            <col key={c} style={{ width: widthOf(c) }} />
          ))}
        </colgroup>
        <TableHeader>
          <TableRow className="border-0 hover:bg-transparent">
            {columns.map((c) => (
              <TableHead key={c} className={cn(HEAD, "truncate text-wz-strong/40 last:border-r-0")}>
                {COLUMN_LABEL.get(c) ?? c}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          <PadRows count={MIN_ROWS} columns={columns} />
        </TableBody>
      </Table>
      <div className="pointer-events-none absolute inset-x-0 top-[300px]">
        <div className="sticky left-0 flex justify-center gap-1.5" style={{ width: viewWidth || "100%" }}>
          {[0, 1, 2].map((i) => (
            <span key={i} className="size-2 animate-pulse rounded-full bg-wz-strong" style={{ animationDelay: `${i * 160}ms` }} />
          ))}
        </div>
      </div>
    </div>
  );
}
