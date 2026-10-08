"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { cn } from "@/lib/utils";
import { formatUsDay, formatWzDayRange, parseUsDay } from "./dates";

/** A preset and the account days it stands for (YYYY-MM-DD, both included). */
export interface WzDateRange {
  preset: string;
  from: string;
  to: string;
}

export interface WzDateRangePickerProps {
  /** Workiz's list, in its order; the id "custom" opens the From / To inputs. */
  presets: { id: string; label: string }[];
  value: WzDateRange;
  onChange: (next: WzDateRange) => void;
  /** The days a preset covers on the account's calendar; null for Custom. */
  rangeOf: (preset: string) => { from: string; to: string } | null;
  className?: string;
}

/**
 * Workiz's date box (`._picker`; callspage_wz_01, _06_date_open,
 * _06_date_custom): 250px, 1px #ddd; the preset's name (14px, 10px 10px 0)
 * over its days (14px/600, 10px) — "Oct 8th, 2026 - Oct 8th, 2026". A click
 * hangs the presets under it, 37px rows between 1px #ddd rules; picking one
 * closes the list. Custom widens the box to 362px and opens "From:" / "To:"
 * inputs (158×32, #f7f7f7, 1px #ccc, radius 2, 14px #666, MM/DD/YYYY) inside
 * it, read on blur or Enter.
 */
export function WzDateRangePicker({ presets, value, onChange, rangeOf, className }: WzDateRangePickerProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  const custom = value.preset === "custom";
  const label = presets.find((p) => p.id === value.preset)?.label ?? "";

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, [open]);

  const pick = (id: string) => {
    setOpen(false);
    const range = rangeOf(id);
    onChange(range ? { preset: id, ...range } : { preset: id, from: value.from, to: value.to });
  };

  const setFrom = (from: string) => onChange({ preset: "custom", from, to: value.to < from ? from : value.to });
  const setTo = (to: string) => onChange({ preset: "custom", from: value.from > to ? to : value.from, to });

  return (
    <div
      ref={rootRef}
      className={cn("relative shrink-0 border border-wz-frame bg-background text-sm leading-4 text-wz-strong", custom ? "w-[362px]" : "w-[250px]", className)}
      onKeyDown={(e) => {
        if (e.key === "Escape" && open) {
          e.stopPropagation();
          setOpen(false);
        }
      }}
    >
      <button
        type="button"
        aria-label={`Date range: ${label}, ${formatWzDayRange(value.from, value.to)}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        onClick={() => setOpen((o) => !o)}
        className="block w-full cursor-pointer text-left"
      >
        <span className="block px-2.5 pt-2.5">{label}</span>
        <span className="block p-2.5 font-semibold whitespace-nowrap">{formatWzDayRange(value.from, value.to)}</span>
      </button>

      {custom ? (
        <div className="flex gap-4 border-t border-wz-frame px-2.5 pt-2.5 pb-[11px]">
          <DayInput label="From" day={value.from} onDay={setFrom} />
          <DayInput label="To" day={value.to} onDay={setTo} />
        </div>
      ) : null}

      {open ? (
        <ul
          id={listId}
          role="listbox"
          aria-label="Date presets"
          className="absolute top-full -right-px -left-px z-30 border border-wz-frame bg-background"
        >
          {presets.map((p) => (
            <li
              key={p.id}
              role="option"
              aria-selected={p.id === value.preset}
              tabIndex={-1}
              onClick={() => pick(p.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  pick(p.id);
                }
              }}
              // rep_jobs_wz_06b_date_hover: no shadow under the list, and the row
              // under the cursor is #e1e1e1 (Workiz's `_picker_options li:hover`).
              className="cursor-pointer border-t border-wz-frame p-2.5 first:border-t-0 hover:bg-[#e1e1e1]"
            >
              {p.label}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/** One Custom end: "From:" over a MM/DD/YYYY box; nonsense is put back. */
function DayInput({ label, day, onDay }: { label: string; day: string; onDay: (day: string) => void }) {
  const [text, setText] = useState(formatUsDay(day));
  const [shown, setShown] = useState(day);
  // A new day from outside (the other end pulled this one along) replaces
  // whatever was typed.
  if (shown !== day) {
    setShown(day);
    setText(formatUsDay(day));
  }
  const commit = () => {
    const parsed = parseUsDay(text);
    if (parsed && parsed !== day) onDay(parsed);
    else setText(formatUsDay(day));
  };
  return (
    <label className="flex w-[158px] flex-col gap-0">
      <span>{label}:</span>
      <input
        aria-label={label}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
          if (e.key === "Enter") commit();
        }}
        className="h-8 w-full rounded-chip border border-input bg-muted px-2.5 text-sm leading-[30px] text-wz-text outline-none focus:border-wz-link"
      />
    </label>
  );
}
