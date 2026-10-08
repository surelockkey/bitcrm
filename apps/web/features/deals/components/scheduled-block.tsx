"use client";

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

/** A new start keeps the end; with no end yet the job ends when it starts. */
export function withStartTime(v: ScheduledValue, t: string): ScheduledValue {
  const [, end] = slotTimes(v.slot);
  return { ...v, slot: t && (end || t) ? `${t}-${end || t}` : "" };
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
  const emit = (patch: Partial<ScheduledValue>) => onChange({ ...value, ...patch });

  const setStartTime = (t: string) => onChange(withStartTime(value, t));
  const setEndTime = (t: string) => onChange(withEndTime(value, t));

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
                onChange={(e) => emit({ date: e.target.value })}
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
                onChange={(e) => emit({ endDate: e.target.value })}
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
