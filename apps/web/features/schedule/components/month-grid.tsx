"use client";

import { useMemo } from "react";
import { useDroppable } from "@dnd-kit/core";
import type { Deal } from "@bitcrm/types";
import { cn } from "@/lib/utils";
import { clockLabel, daysBetween, layoutLanes, monthWeeks } from "../calendar";
import type { CalendarEntry } from "../entries";
import {
  MONTH_HEAD_PX,
  MONTH_HEADER_PX,
  MONTH_LANES,
  MONTH_LINE_PX,
  MONTH_PITCH_PX,
  MONTH_ROW_PX,
  STRIP_BAR_PX,
} from "../geometry";
import { Draggable, EventBar, MonthLine } from "./event-block";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

interface Placed {
  entry: CalendarEntry;
  lane: number;
  from: number;
  span: number;
}

/**
 * Lay a week row out: the bars first (each over its days), then each day's
 * timed jobs, earliest first, in the rows the bars leave free. Rows past the
 * fifth stay hidden behind "View more(N)", N being every job of the day.
 */
function layoutWeek(week: string[], entries: CalendarEntry[]) {
  const first = week[0];
  const last = week[6];
  const bars = entries
    .filter((e) => e.bar && e.startDate <= last && e.endDate >= first)
    .map((e) => ({ entry: e, from: Math.max(0, daysBetween(first, e.startDate)), to: Math.min(6, daysBetween(first, e.endDate)) }));
  const { lanes } = layoutLanes(bars.map((b) => ({ id: b.entry.id, start: b.from, end: b.to + 1 })));
  const placed: Placed[] = [];
  const taken = week.map(() => new Set<number>());
  const total = week.map(() => 0);
  for (const b of bars) {
    const lane = lanes.get(b.entry.id) ?? 0;
    for (let d = b.from; d <= b.to; d++) {
      taken[d].add(lane);
      total[d] += 1;
    }
    if (lane < MONTH_LANES) placed.push({ entry: b.entry, lane, from: b.from, span: b.to - b.from + 1 });
  }
  week.forEach((date, d) => {
    const timed = entries.filter((e) => !e.bar && e.startDate === date).sort((a, b) => a.startMin - b.startMin);
    let lane = 0;
    for (const entry of timed) {
      total[d] += 1;
      while (taken[d].has(lane)) lane++;
      if (lane < MONTH_LANES) placed.push({ entry, lane, from: d, span: 1 });
      taken[d].add(lane);
    }
  });
  const shown = week.map((_, d) => placed.filter((p) => d >= p.from && d < p.from + p.span).length);
  return { placed, total, shown };
}

/**
 * Month — Workiz's DHTMLX month view (pg_schedule_wz_05_month): Sunday-first
 * rows of 166px cells, the date right-aligned in a 21px head (outside the
 * month on #f7f7f7 in #bbb), five 24px rows of jobs — a dot in the job's
 * colour, the start in bold, the words — bars for jobs over several days,
 * and "View more(N)" opening that day.
 */
export function MonthGrid({
  date,
  entries,
  readOnly,
  onOpen,
  onPickDay,
}: {
  date: string;
  entries: CalendarEntry[];
  readOnly: boolean;
  onOpen: (deal: Deal) => void;
  onPickDay: (date: string) => void;
}) {
  const weeks = useMemo(() => monthWeeks(date), [date]);
  const month = date.slice(0, 7);
  const rows = useMemo(() => weeks.map((week) => ({ week, ...layoutWeek(week, entries) })), [weeks, entries]);

  return (
    <div data-schedule-scroll className="relative min-h-0 flex-1 overflow-y-auto">
      <div className="sticky top-0 z-30 grid grid-cols-7 bg-white" style={{ height: MONTH_HEADER_PX }}>
        {WEEKDAYS.map((d) => (
          <div key={d} className="pt-[2px] text-center text-[14px] leading-[21px] text-black">
            {d}
          </div>
        ))}
      </div>
      {rows.map(({ week, placed, total, shown }) => (
        <div key={week[0]} className="relative grid grid-cols-7" style={{ height: MONTH_ROW_PX }}>
          {week.map((day) => (
            <MonthCell key={day} date={day} inMonth={day.startsWith(month)} readOnly={readOnly} />
          ))}
          {placed.map(({ entry, lane, from, span }) => {
            const style = {
              top: MONTH_HEAD_PX + 1 + lane * MONTH_PITCH_PX,
              height: entry.bar ? STRIP_BAR_PX : MONTH_LINE_PX,
              left: `${(from / 7) * 100}%`,
              width: `calc(${(span / 7) * 100}% - 3px)`,
            };
            const look = entry.bar ? (
              <EventBar color={entry.color} done={entry.done} text={entry.text} conflict={entry.conflict} />
            ) : (
              <MonthLine
                color={entry.color}
                done={entry.done}
                time={clockLabel(entry.startMin)}
                text={entry.text.replace(/\s*\n\s*/g, " ").trim()}
              />
            );
            if (!entry.deal) {
              return (
                <div key={entry.id} className="absolute" style={style}>
                  {look}
                </div>
              );
            }
            return (
              <Draggable
                key={entry.id}
                id={`month:${entry.id}`}
                source={{ kind: "month", deal: entry.deal }}
                disabled={readOnly}
                label={entry.title}
                style={style}
                onOpen={() => onOpen(entry.deal!)}
              >
                {look}
              </Draggable>
            );
          })}
          {week.map((day, d) =>
            total[d] > shown[d] ? (
              <button
                key={`more-${day}`}
                type="button"
                className="absolute h-4 pr-[10px] text-right text-[10.67px] leading-4 text-wz-strong hover:underline"
                style={{ top: 142, left: `${(d / 7) * 100}%`, width: `${100 / 7}%` }}
                onClick={() => onPickDay(day)}
              >
                View more({total[d]})
              </button>
            ) : null,
          )}
        </div>
      ))}
    </div>
  );
}

/** One day: the 21px head and the body under it; jobs drop here. */
function MonthCell({ date, inMonth, readOnly }: { date: string; inMonth: boolean; readOnly: boolean }) {
  const { setNodeRef } = useDroppable({ id: `cell:${date}`, data: { kind: "cell", date }, disabled: readOnly });
  return (
    <div ref={setNodeRef} data-day={date} className="flex min-w-0 flex-col">
      <div
        className={cn(
          "border-r border-[#cecece] pr-[5px] text-right text-[12px] leading-[21px]",
          inMonth ? "bg-white text-wz-strong" : "bg-muted text-[#bbbbbb]",
        )}
        style={{ height: MONTH_HEAD_PX }}
      >
        {date.slice(8)}
      </div>
      <div className={cn("flex-1 border-r border-b border-[#cecece]", inMonth ? "bg-white" : "bg-muted")} />
    </div>
  );
}
