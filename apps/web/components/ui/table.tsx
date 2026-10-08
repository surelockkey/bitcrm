"use client"

import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * The Workiz grid — react-table as app.workiz.com skins it on every list
 * (jobs, clients, estimates, invoices, price book, team, job types;
 * uikit_wz_estimates / uikit_wz_pricebook):
 *
 * - header on #f7f7f7: 41px cells, 14px/500 #404040, 10px in, a solid #ccc
 *   rule right and below; a sorted column carries a 3px dark bar on top
 *   (ascending) or at the foot (descending);
 * - cells 20px all round, 14px/16px #404040, a dotted #cfcfcf rule between
 *   columns. Workiz tops its cells; ours centre them by default, because our
 *   rows mix avatars, chips and buttons with one line of text, and a top
 *   edge then reads as crooked (a page wanting Workiz's top edge passes
 *   `align-top`, as the jobs grid does);
 * - rows zebra (#f7f7f7 on the odd ones), rgba(0,0,0,.05) under the cursor
 *   and between rows.
 *
 * A `table-fixed` table keeps the 8px sides it was measured for: its
 * columns carry declared widths sized for them, and Workiz's 20px would clip
 * a price or an ID; it still gets Workiz's 20px top and bottom.
 *
 * `density="compact"` packs the cells (12px / 8px) for tables that
 * live inside a dialog or a side panel — Workiz's stock modal is that dense —
 * and is what a table inside DialogContent / SheetContent gets by default.
 */
type TableDensity = "workiz" | "compact"

const TableDensityContext = React.createContext<TableDensity>("workiz")

/** The table lays out by declared widths (`table-fixed`): cells keep narrow sides. */
const TableFixedContext = React.createContext(false)

/** Which part of the table a row sits in: header rows never hover. */
const TableSectionContext = React.createContext<"head" | "body" | "foot">("body")

/** Sets the density for every table below it (DialogContent / SheetContent use it). */
function TableDensityProvider({ value, children }: { value: TableDensity; children: React.ReactNode }) {
  return <TableDensityContext.Provider value={value}>{children}</TableDensityContext.Provider>
}

function Table({
  className,
  contained = true,
  density,
  ...props
}: React.ComponentProps<"table"> & {
  /**
   * `false` when the frame around the table already scrolls sideways: the
   * table then keeps no scroller of its own, so there is one, not two.
   */
  contained?: boolean
  /** The Workiz grid (default) or the packed one for dialogs and panels. */
  density?: TableDensity
}) {
  const inherited = React.useContext(TableDensityContext)
  const d = density ?? inherited
  const fixed = /(^|\s)table-fixed(\s|$)/.test(className ?? "")
  const table = (
    <TableDensityContext.Provider value={d}>
      <TableFixedContext.Provider value={fixed}>
        <table
          data-slot="table"
          data-density={d}
          className={cn("w-full caption-bottom text-sm text-wz-strong", className)}
          {...props}
        />
      </TableFixedContext.Provider>
    </TableDensityContext.Provider>
  )
  if (!contained) return table
  return (
    <div
      data-slot="table-container"
      className="relative w-full overflow-x-auto"
    >
      {table}
    </div>
  )
}

function TableHeader({ className, ...props }: React.ComponentProps<"thead">) {
  return (
    <TableSectionContext.Provider value="head">
      <thead
        data-slot="table-header"
        // The grey header strip and a #ccc rule under it.
        className={cn("bg-muted [&_tr]:border-b [&_tr]:border-input", className)}
        {...props}
      />
    </TableSectionContext.Provider>
  )
}

function TableBody({ className, ...props }: React.ComponentProps<"tbody">) {
  return (
    <tbody
      data-slot="table-body"
      // Alternating rows, starting on the grey — the way their grid reads.
      className={cn(
        "[&>tr:nth-child(odd)]:bg-muted [&_tr:last-child]:border-0",
        className,
      )}
      {...props}
    />
  )
}

function TableFooter({ className, ...props }: React.ComponentProps<"tfoot">) {
  return (
    <TableSectionContext.Provider value="foot">
      <tfoot
        data-slot="table-footer"
        className={cn(
          "border-t border-input bg-muted font-medium [&>tr]:last:border-b-0",
          className
        )}
        {...props}
      />
    </TableSectionContext.Provider>
  )
}

function TableRow({ className, ...props }: React.ComponentProps<"tr">) {
  const section = React.useContext(TableSectionContext)
  return (
    <tr
      data-slot="table-row"
      className={cn(
        "border-b border-black/5 transition-colors data-[state=selected]:bg-accent",
        // rgba(0,0,0,.05) under the cursor — over the zebra too (`odd:` beats
        // the body's `tr:nth-child(odd)`), never on a filler row
        // (`aria-hidden`, react-table's -padRow) or the header.
        section === "body" &&
          "hover:bg-black/5 odd:not-aria-hidden:hover:bg-black/5 has-aria-expanded:bg-black/5",
        className
      )}
      {...props}
    />
  )
}

/** react-table's sorted-column bar: on top ascending, at the foot descending. */
const SORT_BAR = {
  asc: "shadow-[inset_0_3px_0_0_rgba(0,0,0,0.6)]",
  desc: "shadow-[inset_0_-3px_0_0_rgba(0,0,0,0.6)]",
} as const

function TableHead({
  className,
  sort,
  ...props
}: React.ComponentProps<"th"> & {
  /** This column orders the rows: Workiz's 3px bar, and `aria-sort`. */
  sort?: "asc" | "desc"
}) {
  const density = React.useContext(TableDensityContext)
  return (
    <th
      data-slot="table-head"
      aria-sort={sort ? (sort === "asc" ? "ascending" : "descending") : undefined}
      className={cn(
        "border-r border-input px-2.5 text-left align-middle text-sm leading-[21px] font-medium whitespace-nowrap text-wz-strong last:border-r-0 [&:has([role=checkbox])]:pr-0",
        density === "compact" ? "h-9" : "h-[41px]",
        sort && SORT_BAR[sort],
        className
      )}
      {...props}
    />
  )
}

function TableCell({ className, ...props }: React.ComponentProps<"td">) {
  const density = React.useContext(TableDensityContext)
  const fixed = React.useContext(TableFixedContext)
  return (
    <td
      data-slot="table-cell"
      className={cn(
        "border-r border-dotted border-table-border align-middle text-sm leading-4 whitespace-nowrap text-wz-strong last:border-r-0 [&:has([role=checkbox])]:pr-0",
        density === "compact" ? "px-3 py-2" : fixed ? "px-2 py-5" : "p-5",
        className
      )}
      {...props}
    />
  )
}

function TableCaption({
  className,
  ...props
}: React.ComponentProps<"caption">) {
  return (
    <caption
      data-slot="table-caption"
      className={cn("mt-4 text-sm text-wz-caption", className)}
      {...props}
    />
  )
}

export {
  Table,
  TableHeader,
  TableBody,
  TableFooter,
  TableHead,
  TableRow,
  TableCell,
  TableCaption,
  TableDensityProvider,
  type TableDensity,
}
