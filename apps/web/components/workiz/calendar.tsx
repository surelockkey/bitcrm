"use client";

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";

import { cn } from "@/lib/utils";
import { MuiArrowDropDownIcon, MuiArrowLeftIcon, MuiArrowRightIcon } from "./icons";

/*
 * The month calendar Workiz opens from Starts / Ends (MUI X DateCalendar,
 * formkit_date_open): 320×334 paper, "October 2026 ▾" header with previous /
 * next arrows, S M T W T F S, 36px round days 2px apart, the chosen day
 * filled #1565c0. The ▾ switches to a year list, as MUI's does.
 */

export const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"];
const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const pad = (n: number) => String(n).padStart(2, "0");
export const isoOf = (y: number, m: number, d: number) => `${y}-${pad(m + 1)}-${pad(d)}`;
const daysIn = (y: number, m: number) => new Date(y, m + 1, 0).getDate();

/** "2026-10-08" → [2026, 9, 8], or null. */
export function splitIso(iso: string | undefined | null): [number, number, number] | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso ?? "");
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]) - 1;
  const d = Number(m[3]);
  if (mo < 0 || mo > 11 || d < 1 || d > daysIn(y, mo)) return null;
  return [y, mo, d];
}

function todayIso() {
  const t = new Date();
  return isoOf(t.getFullYear(), t.getMonth(), t.getDate());
}

/** Shift an ISO date by whole days (local calendar, no timezone drift). */
function addDays(iso: string, delta: number) {
  const p = splitIso(iso)!;
  const d = new Date(p[0], p[1], p[2] + delta);
  return isoOf(d.getFullYear(), d.getMonth(), d.getDate());
}

const ICON_BUTTON =
  "flex items-center justify-center rounded-full text-[rgba(0,0,0,0.54)] outline-none transition-colors hover:bg-[rgba(0,0,0,0.04)] focus-visible:bg-[rgba(0,0,0,0.12)] disabled:text-[rgba(0,0,0,0.26)]";

export interface WzCalendarProps {
  /** The chosen day, "YYYY-MM-DD" or "". */
  value: string;
  onSelect: (iso: string) => void;
  min?: string;
  max?: string;
  /** Put focus on the chosen (or today's) day when shown — the picker does. */
  autoFocus?: boolean;
}

export function WzCalendar({ value, onSelect, min, max, autoFocus = false }: WzCalendarProps) {
  const today = useMemo(() => todayIso(), []);
  const start = splitIso(value) ?? splitIso(today)!;
  const [view, setView] = useState<"day" | "year">("day");
  const [shown, setShown] = useState<[number, number]>([start[0], start[1]]);
  const [focusIso, setFocusIso] = useState(value && splitIso(value) ? value : today);
  const gridRef = useRef<HTMLDivElement>(null);
  const yearsRef = useRef<HTMLDivElement>(null);
  const keyboardMoved = useRef(autoFocus);

  const [year, month] = shown;
  const outOfRange = (iso: string) => (!!min && iso < min) || (!!max && iso > max);

  useEffect(() => {
    if (view !== "day" || !keyboardMoved.current) return;
    keyboardMoved.current = false;
    gridRef.current?.querySelector<HTMLButtonElement>(`[data-iso="${focusIso}"]`)?.focus();
  }, [focusIso, view, shown]);

  useEffect(() => {
    if (view !== "year") return;
    const el = yearsRef.current?.querySelector<HTMLElement>('[aria-checked="true"]');
    if (el && yearsRef.current) yearsRef.current.scrollTop = el.offsetTop - 4 * 52;
  }, [view]);

  const page = (delta: number) => {
    const d = new Date(year, month + delta, 1);
    setShown([d.getFullYear(), d.getMonth()]);
  };

  const onGridKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const step: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
    if (!(e.key in step)) return;
    e.preventDefault();
    const next = addDays(focusIso, step[e.key]);
    const p = splitIso(next)!;
    keyboardMoved.current = true;
    setFocusIso(next);
    if (p[0] !== year || p[1] !== month) setShown([p[0], p[1]]);
  };

  // Leading blanks for the weekday the month starts on, then the days.
  const lead = new Date(year, month, 1).getDay();
  const cells: (number | null)[] = [...Array(lead).fill(null), ...Array.from({ length: daysIn(year, month) }, (_, i) => i + 1)];
  const weeks: (number | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));

  const chosenYear = splitIso(value)?.[0] ?? start[0];
  const tabIso = cells.some((d) => d && isoOf(year, month, d) === focusIso)
    ? focusIso
    : isoOf(year, month, 1);

  return (
    <div data-slot="wz-calendar" className="w-[320px] text-[rgba(0,0,0,0.87)] select-none">
      <div className="mt-3 mb-1 flex h-[38px] items-center pr-3 pl-6">
        <div className="mr-auto flex items-center">
          <div aria-live="polite" className="mr-1.5 text-[16px] leading-6 font-medium tracking-[0.15008px]">
            {MONTHS[month]} {year}
          </div>
          <button
            type="button"
            aria-label={
              view === "year" ? "year view is open, switch to calendar view" : "calendar view is open, switch to year view"
            }
            onClick={() => setView(view === "day" ? "year" : "day")}
            className={cn(ICON_BUTTON, "h-8 w-[34px]")}
          >
            <MuiArrowDropDownIcon className={cn("transition-transform", view === "year" && "rotate-180")} />
          </button>
        </div>
        {view === "day" ? (
          <div className="flex">
            <button type="button" aria-label="Previous month" onClick={() => page(-1)} className={cn(ICON_BUTTON, "h-8 w-10")}>
              <MuiArrowLeftIcon />
            </button>
            <button type="button" aria-label="Next month" onClick={() => page(1)} className={cn(ICON_BUTTON, "h-8 w-10")}>
              <MuiArrowRightIcon />
            </button>
          </div>
        ) : null}
      </div>

      {view === "day" ? (
        <div role="grid" aria-labelledby={undefined} ref={gridRef} onKeyDown={onGridKey}>
          <div role="row" className="flex justify-center">
            {WEEKDAYS.map((w, i) => (
              <span
                key={i}
                role="columnheader"
                aria-label={WEEKDAY_NAMES[i]}
                className="mx-[2px] flex h-10 w-9 items-center justify-center text-[12px] leading-[19.92px] tracking-[0.39996px] text-[rgba(0,0,0,0.6)]"
              >
                {w}
              </span>
            ))}
          </div>
          <div role="rowgroup" className="min-h-[240px]">
            {weeks.map((week, wi) => (
              <div key={wi} role="row" className="my-[2px] flex justify-center">
                {week.map((d, di) => {
                  if (d === null) return <span key={`b${di}`} role="presentation" className="mx-[2px] size-9" />;
                  const iso = isoOf(year, month, d);
                  const selected = iso === value;
                  const isToday = iso === today;
                  const off = outOfRange(iso);
                  return (
                    <button
                      key={iso}
                      type="button"
                      role="gridcell"
                      data-iso={iso}
                      aria-selected={selected}
                      aria-current={isToday ? "date" : undefined}
                      disabled={off}
                      tabIndex={iso === tabIso ? 0 : -1}
                      onFocus={() => setFocusIso(iso)}
                      onClick={() => onSelect(iso)}
                      className={cn(
                        "mx-[2px] flex size-9 items-center justify-center rounded-full text-[12px] leading-[19.92px] tracking-[0.39996px] outline-none transition-colors",
                        selected
                          ? "bg-[#1565c0] font-medium text-white hover:bg-[#0d47a1]"
                          : "hover:bg-[rgba(25,118,210,0.04)] focus-visible:bg-[rgba(25,118,210,0.12)]",
                        isToday && !selected && "border border-[rgba(0,0,0,0.6)]",
                        off && "text-[rgba(0,0,0,0.38)]",
                      )}
                    >
                      {d}
                    </button>
                  );
                })}
                {week.length < 7
                  ? Array.from({ length: 7 - week.length }, (_, k) => (
                      <span key={`t${k}`} role="presentation" className="mx-[2px] size-9" />
                    ))
                  : null}
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div
          ref={yearsRef}
          role="radiogroup"
          aria-label="Year"
          className="grid max-h-[280px] grid-cols-4 overflow-y-auto px-1 py-1.5"
        >
          {Array.from({ length: 200 }, (_, i) => 1900 + i).map((y) => (
            <div key={y} className="flex justify-center py-2">
              <button
                type="button"
                role="radio"
                aria-checked={y === chosenYear}
                onClick={() => {
                  setShown([y, month]);
                  setView("day");
                }}
                className={cn(
                  "h-9 w-[72px] rounded-[18px] text-[16px] leading-[1.75] outline-none transition-colors",
                  y === chosenYear ? "bg-[#1565c0] text-white" : "hover:bg-[rgba(0,0,0,0.04)]",
                )}
              >
                {y}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
