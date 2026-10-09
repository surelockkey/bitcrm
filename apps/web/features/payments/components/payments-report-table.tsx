"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import type { PaymentReportRow, PaymentReportStatus } from "@bitcrm/types";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ResizableHead } from "@/components/ui/resizable-head";
import { WzTableNoData } from "@/components/workiz/no-data";
import { useColumnWidths } from "@/lib/table/use-column-widths";
import { formatPhone } from "@/lib/phone";
import { cn } from "@/lib/utils";
import { paymentCellMoney, paymentDay } from "../report";

/*
 * Workiz's Payments report grid, measured off rep_payments_wz_01_default /
 * _03_row_hover / _13_table_right / _15_sort_amount / _11_empty_search:
 *
 * - the whole width under the strip, a 1px #ddd frame; the table scrolls
 *   sideways INSIDE it (1550px of columns in 1398), the page scrolls down;
 * - header 41px on #f7f7f7, 14px/500 #404040, 10px in, solid #ccc rules,
 *   the sorted column's 3px bar (at the foot: newest first);
 * - react-table's columns: 100px each, Job Type 250 (`minWidth`); resizable;
 * - cells 20px all round, top-aligned, 14px/16px #404040, one line ending in
 *   "…"; zebra, rgba(0,0,0,.05) under the cursor, no rules between rows;
 * - never shorter than ten rows (react-table `minRows`).
 */
export type PaymentsReportColumnId =
  | "id"
  | "amount"
  | "date"
  | "status"
  | "type"
  | "confirmation"
  | "description"
  | "client"
  | "tip"
  | "card"
  | "technician"
  | "transactionMethod"
  | "collectedBy"
  | "jobType";

const COLUMNS: { id: PaymentsReportColumnId; label: string; width: number; money?: true }[] = [
  { id: "id", label: "ID", width: 100 },
  { id: "amount", label: "Amount", width: 100, money: true },
  { id: "date", label: "Payment date", width: 100 },
  { id: "status", label: "Status", width: 100 },
  { id: "type", label: "Type", width: 100 },
  { id: "confirmation", label: "Confirmation code", width: 100 },
  { id: "description", label: "Description", width: 100 },
  { id: "client", label: "Client", width: 100 },
  { id: "tip", label: "Tip", width: 100, money: true },
  { id: "card", label: "Card", width: 100 },
  { id: "technician", label: "Technician", width: 100 },
  { id: "transactionMethod", label: "Transaction method", width: 100 },
  { id: "collectedBy", label: "Collected by", width: 100 },
  { id: "jobType", label: "Job Type", width: 250 },
];

/** The grid's columns in Workiz's order; Amount and Tip only for a viewer with `financials.view`. */
export function paymentsReportColumns(money: boolean) {
  return COLUMNS.filter((c) => money || !c.money);
}

const WIDTHS = Object.fromEntries(COLUMNS.map((c) => [c.id, c.width])) as Record<PaymentsReportColumnId, number>;

/** The reader's own widths, remembered per browser. */
const WIDTHS_KEY = "payments-report-v1";

/** react-table's `minRows` on Workiz's report. */
export const MIN_ROWS = 10;

/**
 * A row's height: Workiz's 80px (the client's name, 16px/24px, over their
 * phone; rep_payments_wz_01_default). Declared on the shell's blanks, the
 * records and the filler alike — Workiz's own shell is ten 56px blanks and
 * its rows land 24px lower each (app_audit 2026-10-09: CLS 0.07); ours
 * keep the house rule, one skeleton, then the page where it was.
 */
export const ROW_HEIGHT = 80;
const ROW_STYLE = { height: ROW_HEIGHT };

const FRAME = "relative overflow-x-auto border border-wz-frame";
const TABLE = "table-fixed border-separate border-spacing-0";
const HEAD = "h-[42px] border-b border-r border-input bg-muted px-2.5 text-sm leading-[21px] font-medium text-wz-strong last:border-r-0";
const CELL = "overflow-hidden border-r border-dotted border-table-border p-5 align-top text-sm leading-4 whitespace-nowrap text-wz-strong last:border-r-0";
/** Workiz's `linkButton` (ID, Technician, Collected by): 13px/19px 600 #6aa8ee, underlined; #003366 hovered. */
const LINK = "text-[13px] leading-[19px] font-semibold tracking-[0.2px] text-wz-link underline hover:text-[#003366]";

/**
 * The Status tag (`Tag-module__tag`): 13px white on the state's colour, 4px
 * corners and padding, cut at the cell's edge as Workiz's is. Succeeded's
 * green is sampled (#3acf7d, rep_payments_wz_01_default); Pending and Failed
 * were not on screen and take Workiz's warning / danger colours.
 */
const STATUS: Record<PaymentReportStatus, { label: string; className: string }> = {
  succeeded: { label: "Succeeded", className: "bg-[#3acf7d]" },
  pending: { label: "Pending", className: "bg-wz-toast-warning" },
  failed: { label: "Failed", className: "bg-wz-danger" },
  reversed: { label: "Reversed", className: "bg-wz-danger" },
};

/** What the client cell shows under the name: their first phone, else their first email. */
export interface PaymentsReportContact {
  phone?: string;
  email?: string;
}

export interface PaymentsReportTableProps {
  rows: PaymentReportRow[];
  /** `financials.view`: Amount and Tip are shown. */
  money: boolean;
  dir: "asc" | "desc";
  onSortDate: () => void;
  contactOf: (contactId: string) => PaymentsReportContact | undefined;
  /** A user's name as Workiz prints it ("(2) TX - Cannon Burt"), else the row's own. */
  nameOf: (userId: string | undefined, fallback?: string) => string | undefined;
  busy?: boolean;
}

/** A value standing alone in its cell: one line, "…" where it runs out. */
const Text = ({ children }: { children?: ReactNode }) => <span className="block truncate">{children}</span>;

/** A Workiz link button inside a "…"-ending line (the "…" keeps the cell's colour, as in Workiz). */
function LinkLine({ href, children }: { href: string; children: ReactNode }) {
  return (
    <span className="block truncate">
      <Link href={href} target="_blank" rel="noopener noreferrer" className={LINK}>
        {children}
      </Link>
    </span>
  );
}

function Cell({
  row,
  column,
  contactOf,
  nameOf,
}: {
  row: PaymentReportRow;
  column: PaymentsReportColumnId;
  contactOf: PaymentsReportTableProps["contactOf"];
  nameOf: PaymentsReportTableProps["nameOf"];
}) {
  switch (column) {
    case "id":
      // "<job> (Job)" → the job; it opens in a tab of its own, so the
      // report and its filters stay put.
      return <LinkLine href={`/deals/${row.dealId}`}>{`${row.dealNumber ?? ""} (Job)`}</LinkLine>;
    case "amount":
      return <Text>{paymentCellMoney(row.amount, row.type)}</Text>;
    case "date":
      return <Text>{paymentDay(row.at)}</Text>;
    case "status": {
      const s = row.status ? STATUS[row.status] : undefined;
      // Workiz's tag box is 20px tall, its 16px line centred in it.
      return s ? (
        <span className={cn("inline-flex h-5 items-center rounded-[4px] p-1 align-top text-[13px] leading-4 text-white", s.className)}>
          {s.label}
        </span>
      ) : null;
    }
    case "type":
      return <Text>{row.typeLabel}</Text>;
    case "confirmation":
      return <Text>{row.confirmationCode ?? ""}</Text>;
    case "description":
      return <Text>{row.description ?? ""}</Text>;
    case "client": {
      // Workiz's ClientTableCell: the name (h5 16px/24px ink), then the
      // number as a blue call link, else the email (12px/18px). Both run on
      // to the cell's edge and are cut there.
      const c = contactOf(row.contactId);
      const name = row.clientName ?? "";
      return (
        <div>
          {row.contactId ? (
            <Link
              href={`/contacts/${row.contactId}`}
              target="_blank"
              rel="noopener noreferrer"
              className="block text-base leading-6 tracking-[0.2px] whitespace-nowrap text-foreground hover:underline"
            >
              {name}
            </Link>
          ) : (
            <div className="text-base leading-6 tracking-[0.2px] whitespace-nowrap text-foreground">{name}</div>
          )}
          {c?.phone ? (
            <a href={`tel:${c.phone}`} className="table text-sm leading-4 whitespace-nowrap text-wz-link no-underline hover:underline">
              {formatPhone(c.phone)}
            </a>
          ) : c?.email ? (
            <div className="text-xs leading-[18px] whitespace-nowrap text-foreground">{c.email}</div>
          ) : null}
        </div>
      );
    }
    case "tip":
      return <Text>{paymentCellMoney(row.tip, row.type)}</Text>;
    case "card":
      return <Text>{row.card ?? ""}</Text>;
    case "technician": {
      const name = nameOf(row.technicianId, row.technicianName);
      if (!name) return null;
      return row.technicianId ? <LinkLine href={`/technicians/${row.technicianId}`}>{name}</LinkLine> : <Text>{name}</Text>;
    }
    case "transactionMethod":
      return <Text>{row.transactionMethod ?? ""}</Text>;
    case "collectedBy": {
      const name = nameOf(row.collectedById, row.collectedByName);
      if (!name) return null;
      return row.collectedById ? <LinkLine href={`/technicians/${row.collectedById}`}>{name}</LinkLine> : <Text>{name}</Text>;
    }
    case "jobType":
      return <Text>{row.jobTypeName ?? ""}</Text>;
    default:
      return null;
  }
}

/** The grid's width: every column at its own, and never narrower than the frame. */
const gridWidth = (columns: readonly { id: string }[], widthOf: (id: string) => number) =>
  `max(100%, ${columns.reduce((w, c) => w + widthOf(c.id), 0)}px)`;

/** Blank striped rows up to `MIN_ROWS` — react-table's `-padRow` with its faint rule, at the row height. */
function PadRows({ count, columns }: { count: number; columns: readonly { id: string }[] }) {
  return (
    <>
      {Array.from({ length: Math.max(0, count) }, (_, i) => (
        <TableRow key={`pad-${i}`} aria-hidden className="hover:bg-transparent" style={ROW_STYLE}>
          {columns.map((c) => (
            <TableCell key={c.id} className={cn(CELL, "border-b border-b-black/5")} />
          ))}
        </TableRow>
      ))}
    </>
  );
}

function Colgroup({ columns, widthOf }: { columns: readonly { id: string }[]; widthOf: (id: string) => number }) {
  return (
    <colgroup>
      {columns.map((c) => (
        <col key={c.id} style={{ width: widthOf(c.id) }} />
      ))}
    </colgroup>
  );
}

/**
 * The report grid: Workiz's columns in its order. The rows arrive newest
 * first; Payment date is the one order the server keeps (`dir`), so its
 * header is the only one that sorts.
 */
export function PaymentsReportTable({ rows, money, dir, onSortDate, contactOf, nameOf, busy }: PaymentsReportTableProps) {
  const { widthOf, setWidth, reset } = useColumnWidths(WIDTHS_KEY, WIDTHS);
  const columns = paymentsReportColumns(money);

  return (
    <div className={FRAME} data-slot="payments-report-grid" aria-busy={busy || undefined}>
      <Table contained={false} className={TABLE} style={{ width: gridWidth(columns, widthOf) }}>
        <Colgroup columns={columns} widthOf={widthOf} />
        <TableHeader>
          <TableRow className="border-0 hover:bg-transparent">
            {columns.map((c) => (
              <ResizableHead
                key={c.id}
                columnId={c.id}
                label={c.label}
                width={widthOf(c.id)}
                onResize={(px) => setWidth(c.id, px)}
                onReset={reset}
                sort={c.id === "date" ? dir : undefined}
                className={cn(HEAD, c.id === "date" && "cursor-pointer")}
              >
                {c.id === "date" ? (
                  <button
                    type="button"
                    onClick={onSortDate}
                    aria-label={`Sort by ${c.label}`}
                    className="block w-full cursor-pointer truncate text-left font-medium"
                  >
                    {c.label}
                  </button>
                ) : (
                  <span className="block truncate">{c.label}</span>
                )}
              </ResizableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody className={cn(busy && "opacity-60")}>
          {rows.map((row) => (
            <TableRow key={`${row.kind}:${row.id}`} className="border-0 hover:bg-black/5!" style={ROW_STYLE}>
              {columns.map((c) => (
                <TableCell key={c.id} className={CELL}>
                  <Cell row={row} column={c.id} contactOf={contactOf} nameOf={nameOf} />
                </TableCell>
              ))}
            </TableRow>
          ))}
          <PadRows count={MIN_ROWS - rows.length} columns={columns} />
        </TableBody>
      </Table>
      {rows.length === 0 ? <WzTableNoData /> : null}
    </div>
  );
}

/**
 * The grid while the first page is on its way — Workiz's own loading frame
 * (rep_payments_wz_00_loading → _01): the header in grey, ten blank striped
 * rows and three dots in the middle. Same widths as the grid it turns into.
 */
export function PaymentsReportTableShell({ money }: { money: boolean }) {
  const { widthOf } = useColumnWidths(WIDTHS_KEY, WIDTHS);
  const columns = paymentsReportColumns(money);
  return (
    <div role="status" aria-label="Loading payments" aria-busy="true" data-slot="payments-report-grid" className={FRAME}>
      <Table contained={false} className={TABLE} style={{ width: gridWidth(columns, widthOf) }}>
        <Colgroup columns={columns} widthOf={widthOf} />
        <TableHeader>
          <TableRow className="border-0 hover:bg-transparent">
            {columns.map((c) => (
              <TableHead key={c.id} className={cn(HEAD, "truncate text-wz-strong/40")}>
                {c.label}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          <PadRows count={MIN_ROWS} columns={columns} />
        </TableBody>
      </Table>
      <div className="pointer-events-none absolute inset-x-0 top-[300px] flex justify-center gap-1.5">
        {[0, 1, 2].map((i) => (
          <span key={i} className="size-2 animate-pulse rounded-full bg-wz-strong" style={{ animationDelay: `${i * 160}ms` }} />
        ))}
      </div>
    </div>
  );
}
