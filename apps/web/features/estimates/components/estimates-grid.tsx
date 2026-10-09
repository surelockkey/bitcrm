"use client";

import type { KeyboardEvent, MouseEvent, ReactNode } from "react";
import Link from "next/link";
import { estimateDepositDue, estimateReportAmount, type Contact, type Estimate } from "@bitcrm/types";
import { Table, TableBody, TableCell, TableHeader, TableRow } from "@/components/ui/table";
import { ResizableHead } from "@/components/ui/resizable-head";
import { WzTableNoData } from "@/components/workiz/no-data";
import { useColumnWidths } from "@/lib/table/use-column-widths";
import { cn } from "@/lib/utils";
import { formatMoney } from "@/features/billing/lib";
import { estimateHref } from "@/features/billing/components/client-documents";
import { contactName, extensionOf, formatPhoneWithExtension } from "@/features/clients/lib";
import { clientSubline } from "@/features/clients/clients-list";
import { workizDateTime } from "@/features/reports/billing/lib";
import {
  ESTIMATES_LIST_COLUMNS,
  estimateSourceLabel,
  estimateUpdatedOn,
  type CreatedSort,
  type EstimatesColumnId,
} from "../estimates-list";
import { EstimateRowStatus } from "./estimate-row-status";

/** react-table's `minRows`: Workiz pads its grid to ten rows. */
const MIN_ROWS = 10;

/*
 * react-table as Workiz skins its Estimates grid (uikit_wz_estimates,
 * pg_estimates_wz_04_row_hover): a 1px #ddd frame; the header 42px on
 * #f7f7f7, 14px/500 #404040 10px in, solid #ccc rules, the sorted column's
 * 3px bar; cells 20px all round, top-aligned, 14px/16px, a dotted #cfcfcf
 * rule between columns, one line each, cut at the cell's edge; zebra rows,
 * rgba(0,0,0,.05) under the cursor; blank 57px rows up to ten. Separate
 * borders, as the jobs and clients grids, so the frame keeps its rules.
 */
const FRAME = "relative border border-wz-frame";
const TABLE = "table-fixed w-full border-separate border-spacing-0";
const HEAD = "h-[42px] border-b border-r border-input bg-muted px-2.5 text-sm leading-[21px] font-medium text-wz-strong";
const CELL = "overflow-hidden border-r border-dotted border-table-border p-5 align-top text-sm leading-4 whitespace-nowrap text-wz-strong";
/** Workiz's links in this grid are ink and stay ink under the cursor (pg_estimates_wz_05_number_hover). */
const INK_LINK = "text-foreground no-underline";

const COLUMN_DEFAULTS: Record<string, number> = Object.fromEntries(ESTIMATES_LIST_COLUMNS.map((c) => [c.id, c.width]));

/** A link inside a row opens its own page, not the estimate. */
const own = (e: MouseEvent) => e.stopPropagation();

/** The client cell (Workiz's ClientTableCell): the name, then the email or, without one, the phone. */
function ClientCell({ contact }: { contact: Contact | undefined }) {
  if (!contact) return null;
  const sub = clientSubline(contact);
  return (
    <>
      <div className="text-base leading-6 tracking-[0.2px] text-foreground">{contactName(contact)}</div>
      {sub?.kind === "email" ? (
        <div className="text-xs leading-[18px] text-foreground">{sub.text}</div>
      ) : sub?.kind === "phone" ? (
        <a href={`tel:${sub.phone}`} onClick={own} className="table text-sm leading-4 text-wz-link no-underline">
          {formatPhoneWithExtension(sub.phone, extensionOf(contact, sub.phone))}
        </a>
      ) : null}
    </>
  );
}

/**
 * The Estimates list's grid — Workiz's eight columns: the estimate number
 * (ink link), its name, the client (name over email / phone), Created (day
 * and time over "Added by"), Amount, Status (changed in place when the reader
 * may edit, "Updated: …" under the three that close), Source ("Job - X") and
 * Deposit due. A row opens the estimate; the caller decides how (`onOpen`
 * gets the click: ⌘/Ctrl/middle → a tab of its own). Created carries the
 * sort bar; a click on it turns the order round (`onSort`). The pager goes
 * in the frame under the rows (`footer`), as react-table's
 * `.pagination-bottom`.
 */
export function EstimatesGrid({
  rows,
  contacts,
  author,
  sort,
  onSort,
  onOpen,
  editable,
  footer,
  busy = false,
}: {
  rows: Estimate[];
  contacts: Map<string, Contact>;
  /** Who added it ("Added by …"), when known. */
  author: (e: Estimate) => string | undefined;
  sort: CreatedSort;
  onSort: () => void;
  onOpen: (e: Estimate, ev: MouseEvent | KeyboardEvent) => void;
  /** The reader may change a status (`estimates.edit`). */
  editable: boolean;
  footer?: ReactNode;
  /** The next set is on its way: Workiz's white veil and dots over these rows. */
  busy?: boolean;
}) {
  const { widthOf, setWidth, reset } = useColumnWidths("estimates", COLUMN_DEFAULTS);

  const cell = (e: Estimate, id: EstimatesColumnId): ReactNode => {
    switch (id) {
      case "number":
        return (
          <Link href={estimateHref(e)} onClick={own} className={INK_LINK}>
            {e.number}
          </Link>
        );
      case "name":
        return <span className="block truncate">{e.name ?? ""}</span>;
      case "client":
        return <ClientCell contact={contacts.get(e.contactId)} />;
      case "created": {
        const by = author(e);
        return (
          <>
            <div>{workizDateTime(e.createdAt)}</div>
            {by ? <div className="mt-[5px] text-xs leading-4 text-wz-caption">Added by {by}</div> : null}
          </>
        );
      }
      case "total":
        return <span className="block truncate">{formatMoney(estimateReportAmount(e))}</span>;
      case "status": {
        const updated = estimateUpdatedOn(e);
        return (
          <>
            <EstimateRowStatus estimate={e} editable={editable} />
            {/* Workiz: "Updated: &nbsp;Oct 08, 2026", 12px/18px #999, 6px under the status. */}
            {updated ? <p className="mt-1.5 text-xs leading-[18px] text-wz-caption">{`Updated:  ${updated}`}</p> : null}
          </>
        );
      }
      case "job":
        return e.dealId ? (
          <Link href={`/deals/${e.dealId}`} onClick={own} className={cn("block truncate", INK_LINK)}>
            {estimateSourceLabel(e)}
          </Link>
        ) : null;
      case "deposit":
        return <span className="block truncate">{formatMoney(estimateDepositDue(e))}</span>;
    }
  };

  return (
    <div className={FRAME} aria-busy={busy || undefined}>
      {/* A window narrower than the columns scrolls the grid sideways, as react-table's .rt-table does. */}
      <div className="overflow-x-auto">
        <Table className={TABLE} contained={false} aria-label="Estimates">
          <colgroup>
            {ESTIMATES_LIST_COLUMNS.map((c) => (
              <col key={c.id} style={{ width: widthOf(c.id) }} />
            ))}
          </colgroup>
          <TableHeader>
            <TableRow className="border-0 hover:bg-transparent">
              {ESTIMATES_LIST_COLUMNS.map((c) => (
                <ResizableHead
                  key={c.id}
                  columnId={c.id}
                  label={c.label}
                  width={widthOf(c.id)}
                  onResize={(px) => setWidth(c.id, px)}
                  onReset={reset}
                  sort={c.id === "created" ? sort : undefined}
                  className={HEAD}
                >
                  {c.id === "created" ? (
                    <button type="button" onClick={onSort} aria-label="Sort by Created" className="block w-full cursor-pointer truncate text-left font-medium">
                      {c.label}
                    </button>
                  ) : undefined}
                </ResizableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((e) => (
              <TableRow
                key={e.id}
                tabIndex={0}
                className="cursor-pointer border-0 outline-none hover:bg-black/5! focus-visible:bg-black/5"
                onClick={(ev) => onOpen(e, ev)}
                onAuxClick={(ev) => {
                  if (ev.button === 1) onOpen(e, ev);
                }}
                onKeyDown={(ev) => {
                  if (ev.key === "Enter" && ev.target === ev.currentTarget) onOpen(e, ev);
                }}
              >
                {ESTIMATES_LIST_COLUMNS.map((c) => (
                  <TableCell key={c.id} className={CELL}>
                    {cell(e, c.id)}
                  </TableCell>
                ))}
              </TableRow>
            ))}
            {Array.from({ length: Math.max(0, MIN_ROWS - rows.length) }, (_, i) => (
              <TableRow key={`pad-${i}`} aria-hidden className="border-0 hover:bg-transparent">
                {ESTIMATES_LIST_COLUMNS.map((c) => (
                  <TableCell key={c.id} className={cn(CELL, "h-[57px] border-b border-b-black/5 py-0 [border-bottom-style:solid]")} />
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      {/* pg_estimates_wz_11_period_reopen: 201px down, the band's right edge on the grid's middle (react-table's .rt-noData). */}
      {rows.length === 0 && !busy ? <WzTableNoData className="right-1/2 left-auto translate-x-0 pr-1.5 pl-[26px]" /> : null}
      {busy ? (
        // pg_estimates_wz_10_period_today: the rows stay under a white-80% veil with three ink dots.
        <div role="status" aria-label="Loading" className="absolute inset-0 z-20 bg-white/80">
          <div className="absolute top-[340px] left-1/2 flex -translate-x-1/2 gap-2">
            {[0, 1, 2].map((i) => (
              <span key={i} className="size-[13px] animate-pulse rounded-full bg-foreground" style={{ animationDelay: `${i * 160}ms` }} />
            ))}
          </div>
        </div>
      ) : null}
      {footer}
    </div>
  );
}

/** The grid before its first rows: the same header and widths over ten blank rows. */
export function EstimatesGridSkeleton() {
  return (
    <div className={FRAME} aria-hidden>
      <div className="overflow-x-auto">
        <Table className={TABLE} contained={false}>
          <colgroup>
            {ESTIMATES_LIST_COLUMNS.map((c) => (
              <col key={c.id} style={{ width: c.width }} />
            ))}
          </colgroup>
          <TableHeader>
            <TableRow className="border-0 hover:bg-transparent">
              {ESTIMATES_LIST_COLUMNS.map((c) => (
                <th key={c.id} className={cn(HEAD, "text-left last:border-r-0")}>
                  {c.label}
                </th>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {Array.from({ length: MIN_ROWS }, (_, i) => (
              <TableRow key={i} aria-hidden className="border-0 hover:bg-transparent">
                {ESTIMATES_LIST_COLUMNS.map((c) => (
                  <TableCell key={c.id} className={cn(CELL, "h-[57px] border-b border-b-black/5 py-0 [border-bottom-style:solid]")} />
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
