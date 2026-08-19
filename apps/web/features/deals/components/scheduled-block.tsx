"use client";

import { toast } from "sonner";
import { CalendarDays, Repeat } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
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

/**
 * Workiz-style Scheduled block: Starts (date + time) and Ends (date + time),
 * an all-day toggle that drops the times, a live area clock in the job's
 * timezone, and a recurring-schedule affordance. Emits the whole value on any
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
  const [start, end] = slot && slot.includes("-") ? slot.split("-") : ["", ""];
  const effEndDate = endDate || date;
  const emit = (patch: Partial<ScheduledValue>) =>
    onChange({ date, endDate, slot, allDay, ...patch });

  const setStartTime = (t: string) => emit({ slot: t && (end || t) ? `${t}-${end || t}` : "" });
  const setEndTime = (t: string) => emit({ slot: start && t ? `${start}-${t}` : slot });

  return (
    <div className="space-y-3">
      <AreaClock tz={tz} areaName={areaName} />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label>Starts</Label>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <CalendarDays className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <input
                type="date"
                aria-label="Start date"
                className="h-9 w-full rounded-md border bg-transparent pl-8 pr-2 text-sm"
                value={date}
                onChange={(e) => emit({ date: e.target.value })}
              />
            </div>
            {!allDay ? (
              <div className="w-28 flex-none">
                <TimeSelect label="Start time" value={start} onValue={setStartTime} />
              </div>
            ) : null}
          </div>
        </div>

        <div className="space-y-1.5">
          <Label>Ends</Label>
          <div className="flex gap-2">
            <div className="relative flex-1">
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
            {!allDay ? (
              <div className="w-28 flex-none">
                <TimeSelect label="End time" value={end} onValue={setEndTime} />
              </div>
            ) : null}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => toast.info("Recurring schedules are coming soon.")}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-brand hover:underline"
        >
          <Repeat className="size-3.5" /> Set recurring schedule
        </button>
        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <Checkbox
            aria-label="All-day event"
            checked={allDay}
            onCheckedChange={(c) => emit({ allDay: c === true, slot: c === true ? "" : slot })}
          />
          All-day event
        </label>
      </div>
    </div>
  );
}
