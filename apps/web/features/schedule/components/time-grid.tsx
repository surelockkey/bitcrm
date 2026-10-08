"use client";

import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { useDndMonitor, useDroppable } from "@dnd-kit/core";
import type { Deal } from "@bitcrm/types";
import { cn } from "@/lib/utils";
import { daysBetween, hourLabel, layoutColumn, layoutLanes, weekdayName } from "../calendar";
import type { CalendarEntry } from "../entries";
import {
  CASCADE_PX,
  DAY_HEADER_PX,
  GUTTER_PX,
  HOUR_PX,
  MIN_SPLIT_PX,
  PX_PER_MIN,
  QUARTER_LINES,
  STRIP_BAR_PX,
  STRIP_PITCH_PX,
  stripHeight,
} from "../geometry";
import type { DragSource } from "../reschedule";
import { Draggable, EventBar, EventBox } from "./event-block";
import { useElementWidth } from "./use-element-width";

const HOURS = Array.from({ length: 24 }, (_, h) => h);
/** The shortest box: one quarter-hour row. */
const MIN_BOX_PX = 22;

/**
 * Day and Week — Workiz's DHTMLX day/week views (pg_schedule_wz_01_day_*,
 * 04_week_*): a 65px header ("Fri" over the date, today's in a dark circle),
 * the all-day / multi-day strip with its clock, then the 24 hours, 88px each
 * with quarter-hour lines, beside a 50px gutter ("7 AM"). Overlapping jobs
 * split the column; one too crowded to split cascades 2px apart. No line marks
 * the current time — Workiz draws none here.
 */
export function TimeGrid({
  days,
  today,
  entries,
  readOnly,
  scrollKey,
  scrollHour,
  onOpen,
  onPickDay,
}: {
  days: string[];
  today: string;
  entries: CalendarEntry[];
  readOnly: boolean;
  /** Scroll to `scrollHour` whenever this changes (a new view), as Workiz does on each render of a view. */
  scrollKey: string;
  scrollHour: number;
  onOpen: (deal: Deal) => void;
  /** Week: the date in a column's header opens that day. */
  onPickDay?: (date: string) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const columnsRef = useRef<HTMLDivElement>(null);
  const columnsWidth = useElementWidth(columnsRef);
  const colPx = columnsWidth / days.length;

  useLayoutEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = Math.max(0, scrollHour - 1) * HOUR_PX;
    // Only a new view scrolls; moving a day keeps the reader where they were.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrollKey]);

  const first = days[0];
  const last = days[days.length - 1];

  const bars = useMemo(() => {
    const visible = entries
      .filter((e) => e.bar && e.startDate <= last && e.endDate >= first)
      .map((e) => ({
        entry: e,
        from: Math.max(0, daysBetween(first, e.startDate)),
        to: Math.min(days.length - 1, daysBetween(first, e.endDate)),
      }));
    const { lanes, count } = layoutLanes(visible.map((b) => ({ id: b.entry.id, start: b.from, end: b.to + 1 })));
    return { visible, lanes, count };
  }, [entries, first, last, days.length]);

  const columns = useMemo(
    () =>
      days.map((date) => {
        const timed = entries.filter((e) => !e.bar && e.startDate === date);
        return { date, timed, layout: layoutColumn(timed) };
      }),
    [days, entries],
  );

  return (
    <div ref={scrollRef} data-schedule-scroll className="relative min-h-0 flex-1 overflow-y-auto">
      <div className="sticky top-0 z-30 bg-white">
        {/* .dhx_cal_header: 14px/21px day name over the date, 2px down. */}
        <div className="flex" style={{ height: DAY_HEADER_PX, paddingLeft: GUTTER_PX }}>
          {days.map((date) => (
            <div key={date} className="min-w-0 flex-1 pt-[2px] text-center text-[14px] leading-[21px] text-black">
              <div>{weekdayName(date)}</div>
              <DayNumber date={date} today={date === today} onPick={onPickDay} />
            </div>
          ))}
        </div>
        {bars.count > 0 ? (
          <div className="flex border-t border-[#cecece]" style={{ height: stripHeight(bars.count) }}>
            <div className="relative shrink-0 border-r border-[#cecece]" style={{ width: GUTTER_PX + 1 }}>
              <ClockIcon className="absolute bottom-[2px] left-[10px]" />
            </div>
            <div className="relative min-w-0 flex-1">
              {bars.visible.map(({ entry, from, to }) => {
                const lane = bars.lanes.get(entry.id) ?? 0;
                const style = {
                  top: 2 + lane * STRIP_PITCH_PX,
                  height: STRIP_BAR_PX,
                  left: `calc(${(from / days.length) * 100}% + 1px)`,
                  width: `calc(${((to - from + 1) / days.length) * 100}% - 3px)`,
                };
                return entry.deal && days.length > 1 ? (
                  <Draggable
                    key={entry.id}
                    id={`strip:${entry.id}`}
                    source={{ kind: "days", deal: entry.deal, dayPx: colPx || 1 }}
                    disabled={readOnly}
                    label={entry.title}
                    style={style}
                    snap={{ x: colPx || undefined, y: 0 }}
                    onOpen={() => onOpen(entry.deal!)}
                  >
                    <EventBar color={entry.color} done={entry.done} text={entry.text} conflict={entry.conflict} />
                  </Draggable>
                ) : (
                  <div
                    key={entry.id}
                    className="absolute"
                    style={style}
                    onClick={entry.deal ? () => onOpen(entry.deal!) : undefined}
                  >
                    <EventBar color={entry.color} done={entry.done} text={entry.text} conflict={entry.conflict} />
                  </div>
                );
              })}
            </div>
          </div>
        ) : null}
      </div>

      {/* .dhx_cal_data: the hours under a #cecece rule. */}
      <div className="flex border-t border-[#cecece]" style={{ height: 24 * HOUR_PX }}>
        <div className="relative shrink-0 bg-white" style={{ width: GUTTER_PX }}>
          {HOURS.map((h) => {
            const { h: big, m } = hourLabel(h);
            return (
              <div
                key={h}
                className="flex justify-center border-b border-[#cecece] text-[#404044]"
                style={{ height: HOUR_PX }}
              >
                <span className="text-[22px] leading-[44px]">{big}</span>
                <span className="mt-px text-[11px] leading-[35px]">&nbsp;{m}</span>
              </div>
            );
          })}
          <DragMarker />
        </div>
        <div ref={columnsRef} className="flex min-w-0 flex-1 border-l border-[#cecece]">
          {columns.map(({ date, timed, layout }) => (
            <DayColumn key={date} date={date} readOnly={readOnly}>
              {timed.map((entry) => {
                const pos = layout.get(entry.id) ?? { col: 0, cols: 1 };
                const cascade = colPx > 0 && (colPx - 1) / pos.cols < MIN_SPLIT_PX;
                const style = {
                  top: entry.startMin * PX_PER_MIN,
                  height: Math.max((entry.endMin - entry.startMin) * PX_PER_MIN, MIN_BOX_PX),
                  left: cascade ? 1 + pos.col * CASCADE_PX : `calc(${(pos.col / pos.cols) * 100}% + 1px)`,
                  width: cascade ? colPx - 2 - pos.col * CASCADE_PX : `calc(${100 / pos.cols}% - 2px)`,
                  zIndex: cascade ? 1 + pos.col : 1,
                };
                const box = (
                  <EventBox color={entry.color} done={entry.done} title={entry.title} text={entry.text} conflict={entry.conflict} />
                );
                if (!entry.deal) {
                  return (
                    <div key={entry.id} className="absolute" style={style}>
                      {box}
                    </div>
                  );
                }
                const source: DragSource = { kind: "time", deal: entry.deal, startMin: entry.startMin };
                return (
                  <Draggable
                    key={entry.id}
                    id={`time:${entry.id}`}
                    source={source}
                    disabled={readOnly}
                    label={entry.title}
                    style={style}
                    snap={{ y: MIN_BOX_PX }}
                    onOpen={() => onOpen(entry.deal!)}
                  >
                    {box}
                  </Draggable>
                );
              })}
            </DayColumn>
          ))}
        </div>
      </div>
    </div>
  );
}

/** The date under the day name: 20px/25px #3e4b51; today's white in a 35px #3b4b52 circle. */
function DayNumber({ date, today, onPick }: { date: string; today: boolean; onPick?: (date: string) => void }) {
  const n = String(Number(date.slice(8)));
  const look = today
    ? "mx-auto mt-[1px] grid size-[35px] place-items-center rounded-full bg-foreground text-[20px] leading-[25px] text-white"
    : "mt-[5px] text-[20px] leading-[25px] text-[#3e4b51]";
  if (!onPick) return <div className={look}>{n}</div>;
  return (
    <button type="button" className={cn(look, !today && "w-full")} onClick={() => onPick(date)} aria-label={`Open ${date}`}>
      {n}
    </button>
  );
}

/** One day's column (`.dhx_scale_holder`): quarter-hour lines, a #cecece rule on the right; jobs drop here. */
function DayColumn({ date, readOnly, children }: { date: string; readOnly: boolean; children: React.ReactNode }) {
  const { setNodeRef } = useDroppable({ id: `day:${date}`, data: { kind: "day", date }, disabled: readOnly });
  return (
    <div
      ref={setNodeRef}
      data-day={date}
      className="relative min-w-0 flex-1 border-r border-[#cecece]"
      style={{ backgroundImage: QUARTER_LINES }}
    >
      {children}
    </div>
  );
}

/**
 * The gutter's yellow band while a box is dragged (`.dhx_drag_marker`:
 * #ffe763 at 50%), from where the box would start to where it would end.
 */
function DragMarker() {
  const [band, setBand] = useState<{ top: number; height: number } | null>(null);
  useDndMonitor({
    onDragMove({ active, delta }) {
      const src = active.data.current as DragSource | undefined;
      if (src?.kind !== "time") return setBand(null);
      const slot = src.deal.scheduledTimeSlot?.split("-") ?? [];
      const toMin = (s?: string) => (s ? Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5)) : 0);
      const length = Math.max(toMin(slot[1]) - toMin(slot[0]), 15);
      const start = Math.round((src.startMin + delta.y / PX_PER_MIN) / 15) * 15;
      setBand({ top: start * PX_PER_MIN, height: length * PX_PER_MIN });
    },
    onDragEnd: () => setBand(null),
    onDragCancel: () => setBand(null),
  });
  if (!band) return null;
  return <div aria-hidden className="absolute inset-x-0 bg-[#ffe763] opacity-50" style={band} />;
}

/** Workiz's clock_big.gif: a 31px grey clock face at the foot of the strip's gutter. */
function ClockIcon({ className }: { className?: string }) {
  return (
    <svg aria-hidden width="31" height="31" viewBox="0 0 31 31" className={className}>
      <circle cx="15.5" cy="15.5" r="13.5" fill="#fff" stroke="#999" strokeWidth="2" />
      <circle cx="15.5" cy="15.5" r="11" fill="none" stroke="#e3e3e3" strokeWidth="1" />
      {[0, 90, 180, 270, 30, 60, 120, 150, 210, 240, 300, 330].map((a) => (
        <circle
          key={a}
          cx={15.5 + 9 * Math.sin((a * Math.PI) / 180)}
          cy={15.5 - 9 * Math.cos((a * Math.PI) / 180)}
          r={a % 90 === 0 ? 0.9 : 0.6}
          fill="#888"
        />
      ))}
      <path d="M15.5 15.5V7.5M15.5 15.5l4.5 4.5" stroke="#777" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}
