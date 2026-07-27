"use client";

import { useMemo, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, Clock } from "lucide-react";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

/* ---- time helpers (30-min slots, 6 AM – 9 PM) ---- */
const TIMES: string[] = [];
for (let h = 6; h <= 21; h++) {
  for (const m of [0, 30]) TIMES.push(`${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`);
}
function time12(t: string): string {
  const [h, m] = t.split(":").map(Number);
  const ap = h < 12 ? "AM" : "PM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${ap}`;
}
function plus30(t: string): string {
  const i = TIMES.indexOf(t);
  return i >= 0 && i < TIMES.length - 1 ? TIMES[i + 1] : t;
}

/* ---- date helpers (local, no deps) ---- */
const WEEKDAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const parse = (s?: string) => (s ? new Date(`${s}T00:00:00`) : null);
function prettyDate(s?: string): string {
  const d = parse(s);
  if (!d || Number.isNaN(d.getTime())) return "Pick a date";
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" });
}

/**
 * Schedule picker: a self-contained month calendar for the date plus start/end
 * time dropdowns that produce the backend's `HH:MM-HH:MM` slot. No external
 * calendar dependency.
 */
export function ScheduleField({
  date,
  slot,
  onDate,
  onSlot,
  disabled,
}: {
  date: string | undefined;
  slot: string | undefined;
  onDate: (iso: string | undefined) => void;
  onSlot: (slot: string) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [start, end] = slot && slot.includes("-") ? slot.split("-") : ["", ""];
  const setRange = (s: string, e: string) => onSlot(s && e ? `${s}-${e}` : "");

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label>Date</Label>
        <div className="relative">
          <button
            type="button"
            disabled={disabled}
            onClick={() => setOpen((o) => !o)}
            className={cn(
              "flex h-9 w-full items-center gap-2 rounded-md border px-3 text-left text-sm",
              disabled ? "cursor-not-allowed opacity-60" : "hover:border-border/80",
              !date && "text-muted-foreground",
            )}
          >
            <CalendarDays className="size-4 text-muted-foreground" />
            <span className="flex-1">{prettyDate(date)}</span>
            {date ? (
              <span
                role="button"
                tabIndex={0}
                onClick={(e) => { e.stopPropagation(); onDate(undefined); }}
                className="text-xs text-muted-foreground hover:text-foreground"
              >
                Clear
              </span>
            ) : null}
          </button>

          {open && !disabled ? (
            <>
              <button type="button" aria-label="Close calendar" className="fixed inset-0 z-10 cursor-default" onClick={() => setOpen(false)} />
              <div className="absolute left-0 top-full z-20 mt-1 w-[268px] rounded-lg border bg-popover p-2 shadow-md">
                <MonthGrid
                  selected={date}
                  onPick={(v) => { onDate(v); setOpen(false); }}
                />
              </div>
            </>
          ) : null}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label className="flex items-center gap-1.5"><Clock className="size-3.5" /> Start</Label>
          <TimeSelect value={start} disabled={disabled} onChange={(s) => setRange(s, end || plus30(s))} />
        </div>
        <div className="space-y-1.5">
          <Label>End</Label>
          <TimeSelect value={end} disabled={disabled} onChange={(e) => setRange(start, e)} />
        </div>
      </div>
    </div>
  );
}

function TimeSelect({ value, onChange, disabled }: { value: string; onChange: (v: string) => void; disabled?: boolean }) {
  return (
    <Select value={value || undefined} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger className="h-9 w-full"><SelectValue placeholder="—" /></SelectTrigger>
      <SelectContent className="max-h-60">
        {TIMES.map((t) => (
          <SelectItem key={t} value={t}>{time12(t)}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function MonthGrid({ selected, onPick }: { selected?: string; onPick: (iso: string) => void }) {
  const initial = parse(selected) ?? new Date();
  const [view, setView] = useState(new Date(initial.getFullYear(), initial.getMonth(), 1));
  const todayIso = iso(new Date());

  const cells = useMemo(() => {
    const first = new Date(view.getFullYear(), view.getMonth(), 1);
    const startPad = first.getDay();
    const daysInMonth = new Date(view.getFullYear(), view.getMonth() + 1, 0).getDate();
    const out: (Date | null)[] = [];
    for (let i = 0; i < startPad; i++) out.push(null);
    for (let d = 1; d <= daysInMonth; d++) out.push(new Date(view.getFullYear(), view.getMonth(), d));
    while (out.length % 7 !== 0) out.push(null);
    return out;
  }, [view]);

  const shift = (n: number) => setView(new Date(view.getFullYear(), view.getMonth() + n, 1));

  return (
    <div>
      <div className="mb-1 flex items-center justify-between px-1">
        <button type="button" onClick={() => shift(-1)} className="grid size-7 place-items-center rounded-md hover:bg-muted" aria-label="Previous month"><ChevronLeft className="size-4" /></button>
        <span className="text-sm font-medium">{MONTHS[view.getMonth()]} {view.getFullYear()}</span>
        <button type="button" onClick={() => shift(1)} className="grid size-7 place-items-center rounded-md hover:bg-muted" aria-label="Next month"><ChevronRight className="size-4" /></button>
      </div>
      <div className="grid grid-cols-7 gap-0.5">
        {WEEKDAYS.map((w) => (
          <div key={w} className="py-1 text-center text-[10px] font-semibold uppercase text-muted-foreground">{w}</div>
        ))}
        {cells.map((d, i) => {
          if (!d) return <div key={i} />;
          const v = iso(d);
          const isSel = v === selected;
          const isToday = v === todayIso;
          return (
            <button
              key={i}
              type="button"
              onClick={() => onPick(v)}
              className={cn(
                "grid size-8 place-items-center rounded-md text-sm tabular-nums transition-colors",
                isSel ? "bg-brand font-semibold text-brand-foreground" : "hover:bg-muted",
                !isSel && isToday && "font-semibold text-brand ring-1 ring-brand/40",
              )}
            >
              {d.getDate()}
            </button>
          );
        })}
      </div>
    </div>
  );
}
