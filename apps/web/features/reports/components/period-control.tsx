"use client";

import { useEffect, useRef, useState } from "react";
import { CalendarDays, Check, ChevronDown } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

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

export interface PeriodDays {
  from?: string;
  to?: string;
}

/**
 * Custom's next two days on a report that always needs both: a cleared day
 * keeps the last one, and a From past To (or a To before From) moves the
 * other with it, so the window is never upside down.
 */
export function nextCustomDays(cur: { from: string; to: string }, days: PeriodDays): { from: string; to: string } {
  const from = days.from ?? cur.from;
  const to = days.to ?? cur.to;
  if (from <= to) return { from, to };
  return days.from && days.from !== cur.from ? { from, to: from } : { from: to, to };
}

/**
 * The app's period picker (the jobs board's "Any date"): one button with a
 * calendar, the period and its days on it, opening the list of Workiz's
 * periods — and, for Custom, the two days in the same panel. The reports and
 * the billing lists all pick their dates with it; the page keeps the state.
 */
export function PeriodControl<P extends string>({
  presets,
  preset,
  onPresetChange,
  range,
  custom,
  onCustomChange,
  today,
  label = "Date range",
  className,
}: {
  presets: ReadonlyArray<{ value: P; label: string }>;
  preset: P;
  onPresetChange: (preset: P) => void;
  /** The days the period covers, printed on the button. */
  range: PeriodDays;
  /** Custom's two days, in the panel's From and To. */
  custom: PeriodDays;
  onCustomChange: (days: PeriodDays) => void;
  /** The business's today: the button names the year only outside it. */
  today: string;
  label?: string;
  /** "w-full" fills a period box (the Jobs and Items reports). */
  className?: string;
}) {
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
    <div className={cn("relative", className)}>
      <button
        type="button"
        aria-label={`${label}: ${days ? `${title}, ${days}` : title}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex h-9 w-full items-center gap-2 rounded-md border bg-card px-3 text-sm shadow-xs transition-colors hover:bg-muted/50"
      >
        <CalendarDays className="size-4 shrink-0 text-muted-foreground" />
        <span className="whitespace-nowrap font-medium">{title}</span>
        {days ? <span className="whitespace-nowrap tabular-nums text-muted-foreground">{days}</span> : null}
        <ChevronDown className="ml-auto size-4 shrink-0 text-muted-foreground" />
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
            className="absolute right-0 top-full z-20 mt-1 w-80 rounded-lg border bg-popover p-1.5 shadow-md"
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
                      onPresetChange(p.value);
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
                    value={custom.from ?? ""}
                    max={custom.to || undefined}
                    onChange={(e) => onCustomChange({ ...custom, from: e.target.value || undefined })}
                  />
                </label>
                <label className="space-y-1 text-xs font-medium text-muted-foreground">
                  <span>To</span>
                  <Input
                    type="date"
                    aria-label="To"
                    className="h-8 px-2 text-sm"
                    value={custom.to ?? ""}
                    min={custom.from || undefined}
                    onChange={(e) => onCustomChange({ ...custom, to: e.target.value || undefined })}
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
