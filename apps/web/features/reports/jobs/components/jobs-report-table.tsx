"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowDown, ArrowUp } from "lucide-react";
import type { JobsReportColumnId, JobsReportFilters, JobsReportRow } from "@bitcrm/types";
import { Table, TableBody, TableCell, TableHeader, TableRow } from "@/components/ui/table";
import { ResizableHead } from "@/components/ui/resizable-head";
import { useColumnWidths } from "@/lib/table/use-column-widths";
import { formatPhone } from "@/features/clients/lib";
import { tagSolidClasses } from "@/features/job-tags/lib";
import { cn } from "@/lib/utils";
import { COLUMN_LABEL, accountWall, money, workizDate } from "../lib";

/** Where each column starts; the reader's own widths are remembered as `jobs-report-v2`. */
const WIDTHS: Record<JobsReportColumnId, number> = {
  jobNumber: 96,
  jobName: 160,
  client: 190,
  tags: 150,
  type: 150,
  created: 200,
  scheduled: 200,
  end: 200,
  phone: 140,
  email: 210,
  status: 160,
  tech: 180,
  createdBy: 180,
  address: 200,
  city: 130,
  state: 100,
  zip: 90,
  serviceArea: 180,
  total: 110,
  source: 180,
  externalCompany: 180,
  leadCreated: 200,
  origin: 100,
};

/** A click on one of these values adds it to the filter, as in Workiz. */
type AddFilter = (key: keyof JobsReportFilters, value: string) => void;

function FilterValue({ onClick, label, children }: { onClick: () => void; label: string; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick} title={`Filter by ${label}`} className="max-w-full truncate text-left hover:underline">
      {children}
    </button>
  );
}

function Cell({ row, column, addFilter }: { row: JobsReportRow; column: JobsReportColumnId; addFilter: AddFilter }) {
  switch (column) {
    case "jobNumber":
      return (
        <Link href={`/deals/${row.id}`} target="_blank" rel="noopener noreferrer" className="font-mono text-xs hover:underline">
          {row.jobNumber}
        </Link>
      );
    case "jobName":
      return <>{row.jobName ?? ""}</>;
    case "client":
      return (
        <div className="min-w-0">
          <div className="truncate font-medium">{row.client || "—"}</div>
          {row.clientCompany && row.clientCompany !== row.client ? (
            <div className="truncate text-xs text-muted-foreground">{row.clientCompany}</div>
          ) : null}
        </div>
      );
    case "tags":
      return (
        <div className="flex flex-wrap gap-1">
          {row.tags.map((t) => (
            <button
              key={t.id}
              type="button"
              title={`Filter by ${t.name}`}
              onClick={() => addFilter("tagId", t.id)}
              className={cn("max-w-full truncate rounded-sm px-1.5 py-0.5 text-[10px] font-medium uppercase", tagSolidClasses(t.color ?? "slate"))}
            >
              {t.name}
            </button>
          ))}
        </div>
      );
    case "type":
      return row.jobTypeId && row.type ? (
        <FilterValue label={row.type} onClick={() => addFilter("jobTypeId", row.jobTypeId!)}>
          {row.type}
        </FilterValue>
      ) : null;
    case "created":
      return <>{workizDate(accountWall(row.createdAt))}</>;
    case "scheduled":
      return <>{workizDate(row.scheduled)}</>;
    case "end":
      return <>{workizDate(row.end)}</>;
    case "phone":
      return row.phone ? (
        <a href={`tel:${row.phone}`} className="text-primary hover:underline">
          {formatPhone(row.phone)}
        </a>
      ) : row.phoneMasked ? (
        <span className="text-muted-foreground">Hidden</span>
      ) : null;
    case "email":
      return <>{row.email ?? ""}</>;
    case "status":
      return (
        <div className="min-w-0">
          <FilterValue label={row.status} onClick={() => addFilter("status", row.superStatus)}>
            {row.status}
          </FilterValue>
          {row.subStatus && row.subStatusId ? (
            <div className="truncate text-xs text-muted-foreground uppercase">
              <FilterValue label={row.subStatus} onClick={() => addFilter("status", `${row.superStatus}:${row.subStatusId}`)}>
                {row.subStatus}
              </FilterValue>
            </div>
          ) : null}
        </div>
      );
    case "tech":
      return (
        <div className="flex min-w-0 flex-wrap gap-x-1">
          {row.techIds.map((id, i) =>
            row.tech[i] ? (
              <FilterValue key={id} label={row.tech[i]} onClick={() => addFilter("techId", id)}>
                {row.tech[i]}
                {i < row.techIds.length - 1 ? "," : ""}
              </FilterValue>
            ) : null,
          )}
        </div>
      );
    case "createdBy":
      return row.createdById && row.createdBy ? (
        <FilterValue label={row.createdBy} onClick={() => addFilter("createdBy", row.createdById!)}>
          {row.createdBy}
        </FilterValue>
      ) : (
        <>{row.createdBy}</>
      );
    case "address":
      return <>{row.address ?? ""}</>;
    case "city":
      return <>{row.city ?? ""}</>;
    case "state":
      return <>{row.state ?? ""}</>;
    case "zip":
      return <>{row.zip ?? ""}</>;
    case "serviceArea":
      return row.serviceAreaId && row.serviceArea ? (
        <FilterValue label={row.serviceArea} onClick={() => addFilter("serviceAreaId", row.serviceAreaId!)}>
          {row.serviceArea}
        </FilterValue>
      ) : (
        <>{row.serviceArea ?? ""}</>
      );
    case "total":
      return <span className="tabular-nums">{money(row.total)}</span>;
    case "source":
      return row.sourceId && row.source ? (
        <FilterValue label={row.source} onClick={() => addFilter("sourceId", row.sourceId!)}>
          {row.source}
        </FilterValue>
      ) : null;
    case "externalCompany":
      return row.externalCompanyId && row.externalCompany ? (
        <FilterValue label={row.externalCompany} onClick={() => addFilter("externalCompanyId", row.externalCompanyId!)}>
          {row.externalCompany}
        </FilterValue>
      ) : null;
    case "leadCreated":
      return <>{workizDate(accountWall(row.leadCreated))}</>;
    case "origin":
      return <>{row.origin === "lead" ? "Lead" : "New"}</>;
    default:
      return null;
  }
}

/**
 * The report grid: the visible columns in Workiz's order, each header a
 * server-side sort, values that Workiz lets you click to filter by. Fixed
 * layout with resizable columns, as the other long tables here.
 */
export function JobsReportTable({
  rows,
  columns,
  sort,
  dir,
  onSort,
  addFilter,
  busy,
}: {
  rows: JobsReportRow[];
  columns: JobsReportColumnId[];
  sort: JobsReportColumnId;
  dir: "asc" | "desc";
  onSort: (column: JobsReportColumnId) => void;
  addFilter: AddFilter;
  busy?: boolean;
}) {
  const { widthOf, setWidth, reset } = useColumnWidths("jobs-report-v2", WIDTHS);

  return (
    <div className="overflow-x-auto rounded-md border" aria-busy={busy || undefined}>
      <Table className="table-fixed" style={{ minWidth: columns.reduce((w, c) => w + widthOf(c), 0) }}>
        <colgroup>
          {columns.map((c) => (
            <col key={c} style={{ width: widthOf(c) }} />
          ))}
        </colgroup>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
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
                  className={cn(active && "border-b-2 border-b-foreground")}
                >
                  <button
                    type="button"
                    onClick={() => onSort(c)}
                    aria-label={`Sort by ${label}${active ? `, sorted ${dir === "asc" ? "ascending" : "descending"}` : ""}`}
                    className="flex w-full items-center gap-1 truncate text-left font-medium"
                  >
                    <span className="truncate">{label}</span>
                    {active ? dir === "asc" ? <ArrowUp className="size-3 shrink-0" /> : <ArrowDown className="size-3 shrink-0" /> : null}
                  </button>
                </ResizableHead>
              );
            })}
          </TableRow>
        </TableHeader>
        <TableBody className={cn(busy && "opacity-60")}>
          {rows.map((row) => (
            <TableRow key={row.id} className="align-top">
              {columns.map((c) => (
                <TableCell key={c} className={cn("overflow-hidden text-sm", c === "total" && "text-right")}>
                  <Cell row={row} column={c} addFilter={addFilter} />
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {rows.length === 0 ? <p className="py-10 text-center text-sm text-muted-foreground">No jobs match the filters.</p> : null}
    </div>
  );
}
