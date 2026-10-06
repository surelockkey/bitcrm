"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowDown, ArrowUp, CalendarDays, Check, ChevronDown, ChevronLeft, ChevronRight, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TableHead } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import {
  REPORT_PAGE_SIZES,
  businessToday,
  customRangeError,
  paymentPresetRange,
} from "@/features/payments/report";
import type { DatePreset } from "../lib";

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

/** "Sep 6", or "Sep 6, 2025" outside the current year — a business-day key, read as a calendar day. */
function dayLabel(key: string, thisYear: string): string {
  const d = new Date(`${key}T12:00:00`);
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    ...(key.slice(0, 4) !== thisYear && { year: "numeric" }),
  });
}

/** The days a period covers, as the button prints them: "Sep 6", "Sep 6 – Oct 6". */
function daysLabel(range: { from?: string; to?: string }, today: string): string | null {
  const year = today.slice(0, 4);
  if (range.from && range.to) {
    return range.from === range.to
      ? dayLabel(range.from, year)
      : `${dayLabel(range.from, year)} – ${dayLabel(range.to, year)}`;
  }
  if (range.from) return `From ${dayLabel(range.from, year)}`;
  if (range.to) return `Until ${dayLabel(range.to, year)}`;
  return null;
}

/**
 * The period of a billing list, the way the app picks dates elsewhere (the
 * jobs board's "Any date"): one button with a calendar, the period and its
 * days on it, opening the list of Workiz's periods — and, for Custom, the two
 * days in the same panel. The periods still count on the business clock
 * (`useReportRange`), so "Today" is the business's today wherever the reader is.
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
  const [open, setOpen] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  // Workiz's list is long and All time sits near its end: open on the period in use.
  useEffect(() => {
    if (!open) return;
    listRef.current?.querySelector<HTMLElement>('[aria-pressed="true"]')?.scrollIntoView?.({ block: "nearest" });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  const title = presets.find((p) => p.value === preset)?.label ?? preset;
  const days = daysLabel(range, today);

  return (
    <div className="relative">
      <button
        type="button"
        aria-label={`${label}: ${days ? `${title}, ${days}` : title}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex h-9 items-center gap-2 rounded-md border bg-card px-3 text-sm shadow-xs transition-colors hover:bg-muted/50"
      >
        <CalendarDays className="size-4 shrink-0 text-muted-foreground" />
        <span className="whitespace-nowrap font-medium">{title}</span>
        {days ? <span className="whitespace-nowrap tabular-nums text-muted-foreground">{days}</span> : null}
        <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
      </button>

      {open ? (
        <>
          <button
            type="button"
            tabIndex={-1}
            aria-label="Close the periods"
            className="fixed inset-0 z-10 cursor-default"
            onClick={() => setOpen(false)}
          />
          <div
            role="dialog"
            aria-label={label}
            className="absolute right-0 top-full z-20 mt-1 w-64 rounded-lg border bg-popover p-1.5 shadow-md"
          >
            <div ref={listRef} className="max-h-[min(60vh,22rem)] overflow-y-auto overscroll-contain">
              {presets.map((p) => {
                const active = p.value === preset;
                return (
                  <button
                    key={p.value}
                    type="button"
                    aria-pressed={active}
                    onClick={() => {
                      setPreset(p.value);
                      // Custom needs its two days, which are picked right here.
                      if (p.value !== "custom") setOpen(false);
                    }}
                    className={cn(
                      "flex w-full items-center justify-between gap-2 rounded-md px-2.5 py-1.5 text-left text-sm hover:bg-muted",
                      active && "bg-muted font-medium",
                    )}
                  >
                    {p.label}
                    {active ? <Check className="size-4 shrink-0 text-muted-foreground" /> : null}
                  </button>
                );
              })}
            </div>
            {preset === "custom" ? (
              <div className="mt-1.5 grid grid-cols-2 gap-2 border-t px-1 pt-2 pb-1">
                <label className="space-y-1 text-xs font-medium text-muted-foreground">
                  <span>From</span>
                  <Input
                    type="date"
                    aria-label="From"
                    className="h-8 px-2 text-sm"
                    value={customFrom}
                    max={customTo || undefined}
                    onChange={(e) => setCustomFrom(e.target.value)}
                  />
                </label>
                <label className="space-y-1 text-xs font-medium text-muted-foreground">
                  <span>To</span>
                  <Input
                    type="date"
                    aria-label="To"
                    className="h-8 px-2 text-sm"
                    value={customTo}
                    min={customFrom || undefined}
                    onChange={(e) => setCustomTo(e.target.value)}
                  />
                </label>
              </div>
            ) : null}
          </div>
        </>
      ) : null}
    </div>
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
