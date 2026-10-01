"use client";

import Link from "next/link";
import { ArrowDown, ArrowUp } from "lucide-react";
import type { SalesReportColumnId, SalesReportRow, SalesReportTotals } from "@bitcrm/types";
import { Table, TableBody, TableCell, TableHeader, TableRow } from "@/components/ui/table";
import { ResizableHead } from "@/components/ui/resizable-head";
import { useColumnWidths } from "@/lib/table/use-column-widths";
import { formatPhone } from "@/features/clients/lib";
import { cn } from "@/lib/utils";
import { accountWall, money, workizDate } from "../../jobs/lib";
import { SALES_COLUMN_LABEL, isMoneyColumn, marginLabel } from "../lib";

/** Where each column starts; the reader's own widths are remembered as `sales-report-v1`. */
const WIDTHS: Record<SalesReportColumnId, number> = {
  jobNumber: 96,
  jobName: 150,
  client: 210,
  created: 200,
  scheduled: 200,
  end: 200,
  status: 150,
  type: 160,
  tech: 180,
  total: 110,
  subtotal: 110,
  itemCost: 110,
  laborCost: 110,
  cardExpenses: 120,
  techExpenses: 120,
  paid: 120,
  due: 110,
  tax: 100,
  profit: 130,
  tip: 90,
  source: 190,
  invoice: 100,
  serviceArea: 180,
};

/** An amount, and under Profit Workiz's "NN.NN% margin". */
function Amount({ value, margin }: { value: number | undefined; margin?: number }) {
  return (
    <div className="tabular-nums">
      <div>{money(value)}</div>
      {margin !== undefined ? <div className="text-xs font-normal text-muted-foreground">{marginLabel(margin)}</div> : null}
    </div>
  );
}

function Cell({ row, column, onStatus }: { row: SalesReportRow; column: SalesReportColumnId; onStatus: (status: string) => void }) {
  if (isMoneyColumn(column)) {
    return <Amount value={row[column as keyof SalesReportRow] as number | undefined} margin={column === "profit" ? row.margin : undefined} />;
  }
  switch (column) {
    case "jobNumber":
      return (
        <Link href={`/deals/${row.id}`} target="_blank" rel="noopener noreferrer" className="font-mono text-xs hover:underline">
          {row.jobNumber}
        </Link>
      );
    case "jobName":
      return <>{row.jobName ?? ""}</>;
    case "client": {
      // Workiz prints the first of email, phone and company under the name.
      const extra = row.email ? (
        <span className="truncate">{row.email}</span>
      ) : row.phone ? (
        <a href={`tel:${row.phone}`} className="text-primary hover:underline">
          {formatPhone(row.phone)}
        </a>
      ) : row.clientCompany && row.clientCompany !== row.client ? (
        <span className="truncate">{row.clientCompany}</span>
      ) : null;
      return (
        <div className="min-w-0">
          <div className="truncate font-medium">{row.client || "—"}</div>
          {extra ? <div className="truncate text-xs text-muted-foreground">{extra}</div> : null}
        </div>
      );
    }
    case "created":
      return <>{workizDate(accountWall(row.createdAt))}</>;
    case "scheduled":
      return <>{workizDate(row.scheduled)}</>;
    case "end":
      return <>{workizDate(row.end)}</>;
    case "status":
      return (
        <div className="min-w-0">
          {row.status ? (
            // Workiz: a click on the status adds it to the filter.
            <button type="button" title={`Filter by ${row.status}`} onClick={() => onStatus(row.superStatus)} className="max-w-full truncate text-left hover:underline">
              {row.status}
            </button>
          ) : null}
          {row.subStatus ? <div className="truncate text-xs text-muted-foreground uppercase">{row.subStatus}</div> : null}
        </div>
      );
    case "type":
      return <>{row.type}</>;
    case "tech":
      return <>{row.tech.join(", ")}</>;
    case "source":
      return <>{row.source ?? ""}</>;
    case "invoice":
      return row.invoiceId ? (
        <Link href={`/deals/${row.id}?tab=invoice`} target="_blank" rel="noopener noreferrer" className="font-mono text-xs hover:underline">
          {row.jobNumber}
        </Link>
      ) : null;
    case "serviceArea":
      return <>{row.serviceArea ?? ""}</>;
    default:
      return null;
  }
}

/**
 * The report grid: the visible columns in Workiz's order, each header a
 * server-side sort, Workiz's bold Total row first — over every job the
 * filters and the search keep, not just this page — then the jobs. Fixed
 * layout with resizable columns, as the other long tables here.
 */
export function SalesReportTable({
  rows,
  totals,
  columns,
  sort,
  dir,
  onSort,
  onStatus,
  busy,
}: {
  rows: SalesReportRow[];
  totals: SalesReportTotals;
  columns: SalesReportColumnId[];
  sort: SalesReportColumnId;
  dir: "asc" | "desc";
  onSort: (column: SalesReportColumnId) => void;
  onStatus: (status: string) => void;
  busy?: boolean;
}) {
  const { widthOf, setWidth, reset } = useColumnWidths("sales-report-v1", WIDTHS);

  return (
    // Square corners and one scroller: the frame scrolls, the table does not (see components/ui/table).
    <div className="overflow-x-auto border bg-background" aria-busy={busy || undefined}>
      <Table contained={false} className="table-fixed" style={{ minWidth: columns.reduce((w, c) => w + widthOf(c), 0) }}>
        <colgroup>
          {columns.map((c) => (
            <col key={c} style={{ width: widthOf(c) }} />
          ))}
        </colgroup>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            {columns.map((c) => {
              const label = SALES_COLUMN_LABEL.get(c) ?? c;
              const active = sort === c;
              return (
                <ResizableHead
                  key={c}
                  columnId={c}
                  label={label}
                  width={widthOf(c)}
                  onResize={(px) => setWidth(c, px)}
                  onReset={reset}
                  className={cn(active && "border-b-2 border-b-foreground", isMoneyColumn(c) && "text-right")}
                >
                  <button
                    type="button"
                    onClick={() => onSort(c)}
                    aria-label={`Sort by ${label}${active ? `, sorted ${dir === "asc" ? "ascending" : "descending"}` : ""}`}
                    className={cn("flex w-full items-center gap-1 truncate text-left font-medium", isMoneyColumn(c) && "justify-end")}
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
          <TableRow aria-label="Total" className="bg-muted/40 font-semibold hover:bg-muted/40">
            {columns.map((c, i) => (
              <TableCell key={c} className={cn("overflow-hidden text-sm", isMoneyColumn(c) && "text-right")}>
                {isMoneyColumn(c) ? (
                  <Amount value={totals[c as keyof SalesReportTotals] as number | undefined} margin={c === "profit" ? totals.margin : undefined} />
                ) : i === 0 ? (
                  "Total:"
                ) : null}
              </TableCell>
            ))}
          </TableRow>
          {rows.map((row) => (
            <TableRow key={row.id} className="align-top">
              {columns.map((c) => (
                <TableCell key={c} className={cn("overflow-hidden text-sm", isMoneyColumn(c) && "text-right")}>
                  <Cell row={row} column={c} onStatus={onStatus} />
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {rows.length === 0 ? <p className="py-10 text-center text-sm text-muted-foreground">No sales match the filters.</p> : null}
    </div>
  );
}
