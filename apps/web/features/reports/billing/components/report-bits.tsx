"use client";

import { useState, type ReactNode } from "react";
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TableHead } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import {
  REPORT_PAGE_SIZES,
  businessToday,
  customRangeError,
  paymentPresetRange,
} from "@/features/payments/report";
import type { DatePreset } from "../lib";
import { PeriodControl } from "../../components/period-control";

/**
 * Pieces the billing report pages share: Workiz's date presets on the
 * business clock, its clickable KPI cards, a sortable header, the
 * "Showing X to Y of N results" footer and the Export button.
 */

/** The preset, the custom days, the resolved range and whether it is usable. */
export function useReportRange(initial: DatePreset) {
  const [preset, setPreset] = useState<DatePreset>(initial);
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const today = businessToday();
  const error = preset === "custom" ? customRangeError(customFrom, customTo) : null;
  const range = preset === "custom" ? { from: customFrom || undefined, to: customTo || undefined } : paymentPresetRange(preset, today);
  return { preset, setPreset, customFrom, setCustomFrom, customTo, setCustomTo, range, error, today };
}

/**
 * The period of a billing list: the app's `PeriodControl` on the state of
 * `useReportRange`, whose periods count on the business clock, so "Today" is
 * the business's today wherever the reader is.
 */
export function DateRangeControl({
  presets,
  state,
  label = "Date range",
}: {
  presets: ReadonlyArray<{ value: DatePreset; label: string }>;
  state: ReturnType<typeof useReportRange>;
  label?: string;
}) {
  const { preset, setPreset, customFrom, setCustomFrom, customTo, setCustomTo, range, today } = state;
  return (
    <PeriodControl
      presets={presets}
      preset={preset}
      onPresetChange={setPreset}
      range={range}
      custom={{ from: customFrom || undefined, to: customTo || undefined }}
      onCustomChange={(days) => {
        setCustomFrom(days.from ?? "");
        setCustomTo(days.to ?? "");
      }}
      today={today}
      label={label}
    />
  );
}

/** Workiz's KPI card: the number big, the caption under it, a coloured left border; clickable = filter. */
export function ReportCard({
  value,
  caption,
  active,
  onClick,
  border = "border-l-foreground/70",
  loading,
  swatch,
}: {
  value: string;
  caption: string;
  active?: boolean;
  onClick?: () => void;
  border?: string;
  loading?: boolean;
  swatch?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      aria-label={`${value} ${caption}`}
      className={cn(
        "flex min-w-0 flex-col items-end gap-0.5 rounded-lg border border-l-4 bg-card px-4 py-3 text-right shadow-xs transition-colors hover:bg-muted/40",
        border,
        active && "ring-2 ring-brand",
      )}
      style={swatch ? { borderLeftColor: swatch } : undefined}
    >
      <span className={cn("font-mono text-xl font-semibold tabular-nums", loading && "animate-pulse text-muted-foreground")}>
        {loading ? "—" : value}
      </span>
      <span className="text-xs text-muted-foreground">{caption}</span>
    </button>
  );
}

export function SortHead<S extends string>({
  id,
  label,
  sort,
  dir,
  onSort,
  right,
}: {
  id: S;
  label: string;
  sort: S;
  dir: "asc" | "desc";
  onSort: (id: S) => void;
  right?: boolean;
}) {
  const active = sort === id;
  return (
    <TableHead className={cn("whitespace-nowrap", right && "text-right")} aria-sort={active ? (dir === "asc" ? "ascending" : "descending") : "none"}>
      <button type="button" className="inline-flex items-center gap-1 hover:text-foreground" onClick={() => onSort(id)}>
        {label}
        {active ? dir === "asc" ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" /> : null}
      </button>
    </TableHead>
  );
}

/** "Showing X to Y of N results", Workiz's page sizes, previous / next. */
export function ReportFooter({
  page,
  pageSize,
  total,
  shown,
  onPage,
  onPageSize,
  canNext,
  extra,
}: {
  page: number;
  pageSize: number;
  total: number;
  shown: number;
  onPage: (p: number) => void;
  onPageSize: (s: number) => void;
  canNext?: boolean;
  extra?: ReactNode;
}) {
  const from = shown ? (page - 1) * pageSize + 1 : 0;
  const to = (page - 1) * pageSize + shown;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
      <label className="flex items-center gap-1.5">
        Rows
        <select
          aria-label="Rows per page"
          className="h-8 rounded-md border bg-transparent px-2 text-sm text-foreground"
          value={pageSize}
          onChange={(e) => onPageSize(Number(e.target.value))}
        >
          {REPORT_PAGE_SIZES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </label>
      <span className="tabular-nums">
        Showing {from.toLocaleString("en-US")} to {to.toLocaleString("en-US")} of {total.toLocaleString("en-US")} results
      </span>
      {extra}
      <span className="flex-1" />
      <span className="tabular-nums">
        Page {page} of {pages}
      </span>
      <Button variant="outline" size="icon" className="size-8" aria-label="Previous page" disabled={page <= 1} onClick={() => onPage(page - 1)}>
        <ChevronLeft className="size-4" />
      </Button>
      <Button
        variant="outline"
        size="icon"
        className="size-8"
        aria-label="Next page"
        disabled={!(canNext ?? page < pages)}
        onClick={() => onPage(page + 1)}
      >
        <ChevronRight className="size-4" />
      </Button>
    </div>
  );
}

export function ExportButton({ busy, disabled, onClick }: { busy: boolean; disabled?: boolean; onClick: () => void }) {
  return (
    <Button variant="outline" size="sm" className="h-9 gap-1.5" onClick={onClick} disabled={busy || disabled}>
      <Download className="size-3.5" /> {busy ? "Exporting…" : "Export"}
    </Button>
  );
}

/** Money as the reports print it: `$1,234.50`, `-$981.16`. */
export function money(n: number | undefined): string {
  const v = n ?? 0;
  const abs = Math.abs(v).toLocaleString("en-US", { style: "currency", currency: "USD" });
  return v < 0 ? `-${abs}` : abs;
}
