"use client";

import { useState } from "react";
import { CalendarDays } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { nowScheduleDefault } from "@/lib/timezone";
import { AreaClock } from "./area-clock";

/** 15-min time options across the day, e.g. "08:00" → "8:00 AM". */
const TIMES: string[] = [];
for (let h = 0; h < 24; h++) {
  for (const m of [0, 15, 30, 45]) {
    TIMES.push(`${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`);
  }
}
function time12(t: string): string {
  const [h, m] = t.split(":").map(Number);
  const ap = h < 12 ? "AM" : "PM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${ap}`;
}

/** A day-time dropdown (15-min steps). */
function TimeSelect({
  label,
  value,
  onValue,
}: {
  label: string;
  value: string;
  onValue: (t: string) => void;
}) {
  return (
    <select
      aria-label={label}
      className="h-9 w-full rounded-md border bg-transparent px-2 text-sm"
      value={value}
      onChange={(e) => onValue(e.target.value)}
    >
      <option value="">—</option>
      {TIMES.map((t) => (
        <option key={t} value={t}>{time12(t)}</option>
      ))}
    </select>
  );
}

export interface ScheduledValue {
  date: string;
  endDate: string;
  slot: string;
  allDay: boolean;
}

/*
 * The rules of a schedule, shared by this block and the Workiz one
 * (workiz/schedule-block.tsx) so both forms schedule a job the same way.
 */

/** "08:00-09:30" → ["08:00", "09:30"]; no slot → ["", ""]. */
export function slotTimes(slot: string): [string, string] {
  if (!slot || !slot.includes("-")) return ["", ""];
  const [start, end] = slot.split("-");
  return [start, end];
}

const DAY_MINUTES = 24 * 60;
const DAY_MS = 86_400_000;
const pad = (n: number) => String(n).padStart(2, "0");

/** "HH:MM" → minutes into its day; no time reads as the day's first minute. */
function minutesOf(time: string): number {
  if (!time) return 0;
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

/**
 * A moment on the visit's own wall clock, as minutes since day 0 — so a
 * date and a time compare and subtract as one number, across midnight too.
 */
function moment(date: string, time: string): number {
  return Math.round(Date.parse(`${date}T00:00:00.000Z`) / DAY_MS) * DAY_MINUTES + minutesOf(time);
}
function splitMoment(m: number): { date: string; time: string } {
  const days = Math.floor(m / DAY_MINUTES);
  const rest = m - days * DAY_MINUTES;
  return { date: new Date(days * DAY_MS).toISOString().slice(0, 10), time: `${pad(Math.floor(rest / 60))}:${pad(rest % 60)}` };
}

/** Said with a start move: Ends was set by hand since, so it stays where it was put. */
export interface StartMoveOptions {
  endEdited?: boolean;
}

/**
 * Workiz: moving Starts carries Ends with it — the visit keeps its length,
 * so 10:00–12:00 moved to 14:00 ends at 16:00, and a start typed a day
 * later ends a day later (QA 2026-10-14 #11: ours left Ends behind, and the
 * job ended before it began). An end already before its start is not
 * carried along: the moved visit ends when it starts. Once Ends was set by
 * hand it stays put, and a start moved past it only drags it up to itself.
 */
export function withStart(
  v: ScheduledValue,
  next: { date?: string; time?: string },
  { endEdited = false }: StartMoveOptions = {},
): ScheduledValue {
  const date = next.date ?? v.date;
  const [wasStart, wasEnd] = slotTimes(v.slot);
  const start = next.time ?? wasStart;
  // Unscheduled: no day to move anything on. A time typed here still reads as a slot.
  if (!date) return { ...v, date, slot: start ? `${start}-${wasEnd || start}` : "" };
  const timed = Boolean(start);
  const from = moment(date, start);
  const wasFrom = v.date ? moment(v.date, timed ? wasStart : "") : from;
  const wasTo = v.date ? moment(v.endDate || v.date, timed ? wasEnd : "") : from;
  const to = endEdited ? Math.max(from, wasTo) : from + Math.max(0, wasTo - wasFrom);
  const end = splitMoment(to);
  return { ...v, date, endDate: end.date, slot: timed ? `${start}-${end.time}` : "" };
}

/** A new start time — see `withStart`. Clearing it clears the times. */
export function withStartTime(v: ScheduledValue, t: string, opts?: StartMoveOptions): ScheduledValue {
  return withStart(v, { time: t }, opts);
}

/** A new start date — see `withStart`. */
export function withStartDate(v: ScheduledValue, date: string, opts?: StartMoveOptions): ScheduledValue {
  return withStart(v, { date }, opts);
}

/**
 * The end as one string. A block remembers the end the user set by hand and
 * treats it as theirs only while the value still carries it — the moment a
 * job type's duration or a zone default moves the end, the rules own it again.
 */
export function endOf(v: ScheduledValue): string {
  return `${v.endDate || v.date}|${slotTimes(v.slot)[1]}`;
}

/** A new end needs a start; without one the slot is left as it was. */
export function withEndTime(v: ScheduledValue, t: string): ScheduledValue {
  const [start] = slotTimes(v.slot);
  return { ...v, slot: start && t ? `${start}-${t}` : v.slot };
}

/** All-day drops the times. */
export function withAllDay(v: ScheduledValue, allDay: boolean): ScheduledValue {
  return { ...v, allDay, slot: allDay ? "" : v.slot };
}

/**
 * Workiz's Scheduled switch: off leaves the job unscheduled (no date, no
 * times); on again starts from now in the job's timezone, as a new job does.
 */
export function withScheduled(
  v: ScheduledValue,
  on: boolean,
  tz?: string,
  now: Date = new Date(),
): ScheduledValue {
  if (!on) return { date: "", endDate: "", slot: "", allDay: false };
  if (v.date) return v;
  const d = nowScheduleDefault(tz, now);
  return { date: d.date, endDate: d.date, slot: `${d.start}-${d.end}`, allDay: false };
}

/** `YYYY-MM-DD` moved by `days`. */
function shiftDay(day: string, days: number): string {
  return new Date(Date.parse(`${day}T00:00:00.000Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

/**
 * Workiz's job type carries a Duration ("How long does this type of job
 * usually take?"): picking the type ends the visit that long after its
 * start — on a later day when it runs past midnight. An all-day, unscheduled
 * or timeless visit has no times to move and is left as it is.
 */
export function withDuration(v: ScheduledValue, minutes: number): ScheduledValue {
  if (!v.date || v.allDay) return v;
  const [start] = slotTimes(v.slot);
  if (!start) return v;
  const [h, m] = start.split(":").map(Number);
  const end = h * 60 + m + Math.max(0, Math.round(minutes));
  const days = Math.floor(end / DAY_MINUTES);
  const rest = end % DAY_MINUTES;
  const pad = (n: number) => String(n).padStart(2, "0");
  return {
    ...v,
    endDate: days ? shiftDay(v.date, days) : v.date,
    slot: `${start}-${pad(Math.floor(rest / 60))}:${pad(rest % 60)}`,
  };
}

/**
 * Workiz-style Scheduled block: Starts (date + time) and Ends (date + time),
 * an all-day toggle that drops the times, a live area clock in the job's
 * timezone. Emits the whole value on any
 * change; the page maps it onto the deal's scheduledDate/EndDate/TimeSlot/allDay.
 */
export function ScheduledBlock({
  date,
  endDate,
  slot,
  allDay,
  tz,
  areaName,
  onChange,
}: ScheduledValue & {
  tz?: string;
  areaName?: string;
  onChange: (next: ScheduledValue) => void;
}) {
  const value: ScheduledValue = { date, endDate, slot, allDay };
  const [start, end] = slotTimes(slot);
  const effEndDate = endDate || date;
  // The end the user set by hand, theirs while the value still carries it.
  const [handEnd, setHandEnd] = useState<string | null>(null);
  const endEdited = handEnd !== null && handEnd === endOf(value);
  const setEnd = (next: ScheduledValue) => {
    setHandEnd(endOf(next));
    onChange(next);
  };

  const setStartDate = (d: string) => onChange(withStartDate(value, d, { endEdited }));
  const setStartTime = (t: string) => onChange(withStartTime(value, t, { endEdited }));
  const setEndDate = (d: string) => setEnd({ ...value, endDate: d });
  const setEndTime = (t: string) => setEnd(withEndTime({ ...value, endDate: effEndDate }, t));

  return (
    <div className="space-y-3">
      <AreaClock tz={tz} areaName={areaName} />

      {/* Two rows: Starts, then Ends. Each is a date plus (unless all-day) an
          "At" time — the Workiz layout. */}
      <div className="space-y-3">
        <div className={allDay ? "grid grid-cols-1" : "grid grid-cols-[1fr_9rem] gap-3"}>
          <div className="space-y-2.5">
            <Label>Starts</Label>
            <div className="relative">
              <CalendarDays className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <input
                type="date"
                aria-label="Start date"
                className="h-9 w-full rounded-md border bg-transparent pl-8 pr-2 text-sm"
                value={date}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </div>
          </div>
          {!allDay ? (
            <div className="space-y-2.5">
              <Label>At</Label>
              <TimeSelect label="Start time" value={start} onValue={setStartTime} />
            </div>
          ) : null}
        </div>

        <div className={allDay ? "grid grid-cols-1" : "grid grid-cols-[1fr_9rem] gap-3"}>
          <div className="space-y-2.5">
            <Label>Ends</Label>
            <div className="relative">
              <CalendarDays className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <input
                type="date"
                aria-label="End date"
                min={date || undefined}
                className="h-9 w-full rounded-md border bg-transparent pl-8 pr-2 text-sm"
                value={effEndDate}
                onChange={(e) => setEndDate(e.target.value)}
              />
            </div>
          </div>
          {!allDay ? (
            <div className="space-y-2.5">
              <Label>At</Label>
              <TimeSelect label="End time" value={end} onValue={setEndTime} />
            </div>
          ) : null}
        </div>
      </div>

      <label className="flex w-fit cursor-pointer items-center gap-2 text-sm">
        <Checkbox
          aria-label="All-day event"
          checked={allDay}
          onCheckedChange={(c) => onChange(withAllDay(value, c === true))}
        />
        All-day event
      </label>
    </div>
  );
}
