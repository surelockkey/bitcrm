"use client";

import { useState } from "react";

import { cn } from "@/lib/utils";
import { ordinal } from "./dates";

const MONTHS = [
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
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const DAY_NAMES = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

const iso = (d: Date) => d.toISOString().slice(0, 10);
const utc = (day: string) => new Date(`${day}T00:00:00.000Z`);

/** The weeks (Sunday first) a month ("2026-10") touches — react-datepicker shows exactly those. */
export function dayPickerWeeks(month: string): string[][] {
  const [y, m] = month.split("-").map(Number);
  const first = new Date(Date.UTC(y, m - 1, 1));
  const last = new Date(Date.UTC(y, m, 0));
  const start = new Date(first);
  start.setUTCDate(1 - first.getUTCDay());
  const weeks: string[][] = [];
  const cur = new Date(start);
  while (cur <= last) {
    const week: string[] = [];
    for (let i = 0; i < 7; i++) {
      week.push(iso(cur));
      cur.setUTCDate(cur.getUTCDate() + 1);
    }
    weeks.push(week);
  }
  return weeks;
}

const shiftMonth = (month: string, n: number) => {
  const [y, m] = month.split("-").map(Number);
  return iso(new Date(Date.UTC(y, m - 1 + n, 1))).slice(0, 7);
};

/** "Choose Monday, October 5th, 2026" — react-datepicker's own day label. */
const dayLabel = (day: string) => {
  const d = utc(day);
  return `Choose ${WEEKDAYS[d.getUTCDay()]}, ${MONTHS[d.getUTCMonth()]} ${ordinal(d.getUTCDate())}, ${d.getUTCFullYear()}`;
};

/**
 * react-datepicker's stock month, the calendar Workiz hangs under the
 * report box's From: / To: inputs (rep_jobs_wz_16c_custom_from_click):
 * 242×235, 1px #aeaeae, 0.3rem corners; a #f0f0f0 header with the month
 * (15.1px bold) between two #ccc arrow triangles and Su…Sa; 27px days
 * (12.8px Helvetica), the chosen one #216ba5 with white digits, today bold;
 * only the weeks the month touches. A small #f0f0f0 nib points up at the input.
 */
export function WzDayPicker({
  value,
  today,
  onSelect,
  className,
}: {
  /** The chosen day ("YYYY-MM-DD"); its month opens first. */
  value: string;
  /** The day drawn bold. */
  today: string;
  onSelect: (day: string) => void;
  className?: string;
}) {
  const [month, setMonth] = useState(() => (value || today).slice(0, 7));
  const [y, m] = month.split("-").map(Number);
  const title = `${MONTHS[m - 1]} ${y}`;

  return (
    <div
      data-slot="wz-day-picker"
      // A press inside must not blur the input it belongs to.
      onMouseDown={(e) => e.preventDefault()}
      className={cn(
        "relative w-[242px] rounded-[4.8px] border border-[#aeaeae] bg-white font-[family-name:Helvetica_Neue,Helvetica,Arial,sans-serif] text-[12.8px] leading-4 tracking-normal text-black",
        className,
      )}
    >
      {/* react-datepicker__triangle: the nib, its edge #aeaeae, its face #f0f0f0. */}
      <span
        aria-hidden
        className="absolute -top-2 left-[42px] size-0 border-x-8 border-b-8 border-x-transparent border-b-[#aeaeae]"
      />
      <span
        aria-hidden
        className="absolute -top-[7px] left-[42px] size-0 border-x-8 border-b-8 border-x-transparent border-b-[#f0f0f0]"
      />
      <div className="rounded-t-[4.8px] border-b border-[#aeaeae] bg-[#f0f0f0] pt-2">
        <div className="relative">
          <button
            type="button"
            aria-label="Previous Month"
            onClick={() => setMonth((cur) => shiftMonth(cur, -1))}
            className="absolute top-0.5 left-2.5 size-0 border-[7px] border-transparent border-r-[#ccc] hover:border-r-[#b3b3b3]"
          />
          <div className="text-center text-[15.104px] leading-4 font-bold">{title}</div>
          <button
            type="button"
            aria-label="Next Month"
            onClick={() => setMonth((cur) => shiftMonth(cur, 1))}
            className="absolute top-0.5 right-2.5 size-0 border-[7px] border-transparent border-l-[#ccc] hover:border-l-[#b3b3b3]"
          />
        </div>
        <div className="mt-[3px] flex justify-center" aria-hidden>
          {DAY_NAMES.map((d) => (
            <div key={d} className="m-[2.656px] w-[27.2px] text-center leading-[27.2px]">
              {d}
            </div>
          ))}
        </div>
      </div>
      <div role="grid" aria-label={title} className="m-[6.4px] text-center">
        {dayPickerWeeks(month).map((week) => (
          <div key={week[0]} role="row" className="flex justify-center">
            {week.map((day) => {
              const chosen = day === value;
              return (
                <div key={day} role="gridcell">
                  <button
                    type="button"
                    aria-label={dayLabel(day)}
                    aria-pressed={chosen}
                    aria-current={day === today ? "date" : undefined}
                    onClick={() => onSelect(day)}
                    className={cn(
                      "m-[2.656px] w-[27.2px] cursor-pointer rounded-[4.8px] leading-[27.2px]",
                      chosen ? "bg-[#216ba5] text-white hover:bg-[#1d5d90]" : "hover:bg-[#f0f0f0]",
                      day === today && "font-bold",
                    )}
                  >
                    {Number(day.slice(8))}
                  </button>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
