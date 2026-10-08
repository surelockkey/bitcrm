"use client";

import { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useDroppable } from "@dnd-kit/core";
import type { Deal } from "@bitcrm/types";
import { cn } from "@/lib/utils";
import { daysBetween, layoutLanes, timelineHourLabel, weekdayName } from "../calendar";
import type { CalendarEntry } from "../entries";
import {
  TL_BAR_PX,
  TL_HEADER_PX,
  TL_HOUR_PX,
  TL_LANE_PX,
  TL_PX_PER_MIN,
  TL_SECTION_PX,
  TLW_HEADER_PX,
  TLW_SECTION_PX,
  timelineRowHeight,
} from "../geometry";
import { outOfHoursRanges, type WorkingHours } from "../lib";
import type { DragSource, DropZone } from "../reschedule";
import { Draggable, EventBar } from "./event-block";
import { useElementWidth } from "./use-element-width";

/** One Timeline row: a technician, or (id null) the Unassigned jobs. */
export interface TimelineRow {
  id: string | null;
  name: string;
  /** The second line: the person's role ("tech", "admin" in Workiz). */
  role?: string;
  /** The avatar's colour. */
  color: string;
  photoUrl?: string;
  hours?: WorkingHours;
}

const HOURS = Array.from({ length: 24 }, (_, h) => h);

interface Placed {
  entry: CalendarEntry;
  left: number;
  width: number;
  lane: number;
}

/**
 * Timeline and Timeline Week — Workiz's DHTMLX timeline views
 * (pg_schedule_wz_06_timeline*, 07_timeline_week*): the Unassigned row first,
 * then one row per technician (avatar, name, role) at least 75px tall; the
 * jobs as 22px bars on 23px lanes along 70px hours (Timeline) or whole days
 * (Timeline Week); the current time as a red line. A bar dropped on another
 * row changes who is on the job.
 */
export function TimelineGrid({
  mode,
  date,
  days,
  today,
  nowMin,
  rows,
  entries,
  readOnly,
  scrollKey,
  scrollHour,
  onOpen,
}: {
  mode: "day" | "week";
  date: string;
  /** Timeline Week: Sunday … Saturday. */
  days: string[];
  today: string;
  /** Minutes since midnight now (browser clock), for the red line. */
  nowMin: number;
  rows: TimelineRow[];
  entries: CalendarEntry[];
  readOnly: boolean;
  scrollKey: string;
  scrollHour: number;
  onOpen: (deal: Deal) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const section = mode === "day" ? TL_SECTION_PX : TLW_SECTION_PX;
  const scrollerWidth = useElementWidth(scrollRef);
  // Timeline Week fills the width (no sideways scroll), the Timeline is 24 × 70px.
  const dayPx = mode === "week" ? Math.max((scrollerWidth - section) / 7, 0) : 0;
  const dataWidth = mode === "day" ? 24 * TL_HOUR_PX : undefined;

  useLayoutEffect(() => {
    if (mode === "day" && scrollRef.current) scrollRef.current.scrollLeft = Math.max(0, scrollHour - 1) * TL_HOUR_PX;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrollKey]);

  const laidOut = useMemo(
    () =>
      rows.map((row) => {
        const mine = entries.filter((e) => (row.id ? e.techIds.includes(row.id) : e.techIds.length === 0 && e.kind === "job"));
        const placed: Omit<Placed, "lane">[] = [];
        for (const entry of mine) {
          if (mode === "day") {
            if (entry.startDate > date || entry.endDate < date) continue;
            const start = entry.startDate < date ? 0 : entry.startMin;
            const end = entry.endDate > date ? 1440 : Math.max(entry.endMin, entry.startMin);
            placed.push({ entry, left: start * TL_PX_PER_MIN, width: Math.max((end - start) * TL_PX_PER_MIN, 1) });
          } else {
            const from = daysBetween(days[0], entry.startDate);
            const to = daysBetween(days[0], entry.endDate);
            if (to < 0 || from > 6) continue;
            const a = Math.max(from, 0);
            const b = Math.min(to, 6);
            // Workiz's week timeline gives a job its whole day cells.
            placed.push({ entry, left: a, width: b - a + 1 });
          }
        }
        const { lanes, count } = layoutLanes(placed.map((p) => ({ id: p.entry.id, start: p.left, end: p.left + p.width })));
        return { row, placed: placed.map((p) => ({ ...p, lane: lanes.get(p.entry.id) ?? 0 })), height: timelineRowHeight(count) };
      }),
    [rows, entries, mode, date, days],
  );

  const nowLeft =
    mode === "day"
      ? date === today
        ? nowMin * TL_PX_PER_MIN
        : null
      : days.includes(today)
        ? (days.indexOf(today) + nowMin / 1440) * dayPx
        : null;

  return (
    <div ref={scrollRef} data-schedule-scroll className="relative min-h-0 flex-1 overflow-auto">
      <div className="relative" style={{ width: dataWidth ? section + dataWidth : "100%" }}>
        {/* The header: an empty corner (Workiz's "Edit Order" — we have no row order to edit) and the scale. */}
        <div
          className="sticky top-0 z-30 flex border-b border-[#cecece] bg-white"
          style={{ height: mode === "day" ? TL_HEADER_PX : TLW_HEADER_PX }}
        >
          <div className="sticky left-0 z-10 shrink-0 border-r border-[#cecece] bg-white" style={{ width: section }} />
          {mode === "day"
            ? HOURS.map((h) => (
                <div
                  key={h}
                  className="shrink-0 border-r border-[#cecece] pt-[2px] text-center text-[14px] leading-[21px] text-black"
                  style={{ width: TL_HOUR_PX }}
                >
                  {timelineHourLabel(h)}
                </div>
              ))
            : days.map((d) => (
                <div key={d} className="min-w-0 flex-1 pt-[2px] text-center text-[14px] leading-[21px] text-black">
                  <div>{weekdayName(d)}</div>
                  {d === today ? (
                    <div className="mx-auto mt-[1px] grid size-[35px] place-items-center rounded-full bg-foreground text-[20px] leading-[25px] text-white">
                      {Number(d.slice(8))}
                    </div>
                  ) : (
                    <div className="mt-[5px] text-[20px] leading-[25px] text-[#3e4b51]">{Number(d.slice(8))}</div>
                  )}
                </div>
              ))}
        </div>

        {laidOut.map(({ row, placed, height }) => (
          <div key={row.id ?? "unassigned"} className="flex" style={{ height }}>
            <SectionCell row={row} width={section} />
            <RowArea
              zone={
                mode === "day"
                  ? { kind: "row", axis: "time", techId: row.id, date }
                  : { kind: "row", axis: "days", techId: row.id, days, dayPx }
              }
              readOnly={readOnly}
              mode={mode}
              dayPx={dayPx}
            >
              {mode === "day" && row.hours
                ? outOfHoursRanges(row.hours, date).map(([a, b]) => (
                    <div
                      key={a}
                      aria-hidden
                      className="absolute inset-y-0 bg-[#c0c0c0] opacity-20"
                      style={{ left: a * TL_PX_PER_MIN, width: (b - a) * TL_PX_PER_MIN }}
                    />
                  ))
                : null}
              {placed.map(({ entry, left, width, lane }) => {
                const x = mode === "day" ? left : left * dayPx;
                const w = mode === "day" ? width : width * dayPx;
                const style = { top: 2 + lane * TL_LANE_PX, height: TL_BAR_PX, left: x + 1, width: Math.max(w - 3, 6) };
                const bar = <EventBar color={entry.color} done={entry.done} text={entry.text.replace(/\s*\n\s*/g, " ").trim()} tall conflict={entry.conflict} />;
                if (!entry.deal) {
                  return (
                    <div key={entry.id} className="absolute" style={style}>
                      {bar}
                    </div>
                  );
                }
                const source: DragSource =
                  mode === "day"
                    ? { kind: "tl-time", deal: entry.deal, startMin: entry.startMin, fromTechId: row.id }
                    : { kind: "tl-days", deal: entry.deal, dayPx: dayPx || 1, fromTechId: row.id };
                return (
                  <Draggable
                    key={entry.id}
                    id={`tl:${row.id ?? "none"}:${entry.id}`}
                    source={source}
                    disabled={readOnly}
                    label={entry.title}
                    style={style}
                    snap={mode === "day" ? { x: 15 * TL_PX_PER_MIN } : { x: dayPx || undefined }}
                    onOpen={() => onOpen(entry.deal!)}
                  >
                    {bar}
                  </Draggable>
                );
              })}
              {nowLeft !== null ? (
                <div
                  aria-hidden
                  data-slot="schedule-now"
                  className="pointer-events-none absolute inset-y-0 z-20 w-0 border-l-2 border-[#ff0000] opacity-50"
                  style={{ left: nowLeft }}
                />
              ) : null}
            </RowArea>
          </div>
        ))}
      </div>
    </div>
  );
}

/** A row's data area: the hour (or day) rules; jobs drop here. */
function RowArea({
  zone,
  readOnly,
  mode,
  dayPx,
  children,
}: {
  zone: DropZone;
  readOnly: boolean;
  mode: "day" | "week";
  dayPx: number;
  children: ReactNode;
}) {
  const techId = zone.kind === "row" ? zone.techId : null;
  const { setNodeRef } = useDroppable({ id: `row:${techId ?? "none"}`, data: zone, disabled: readOnly });
  const rules =
    mode === "day"
      ? { backgroundImage: `repeating-linear-gradient(to right, transparent 0 ${TL_HOUR_PX - 1}px, #cecece ${TL_HOUR_PX - 1}px ${TL_HOUR_PX}px)` }
      : dayPx > 0
        ? {
            backgroundImage: "linear-gradient(to right, transparent calc(100% - 1px), #cecece calc(100% - 1px))",
            backgroundSize: `${dayPx}px 100%`,
          }
        : undefined;
  return (
    <div ref={setNodeRef} className={cn("relative min-w-0 flex-1 border-b border-[#cecece] bg-white")} style={rules}>
      {children}
    </div>
  );
}

/** The row's name cell (`.dhx_matrix_scell`), kept in view while the hours scroll. */
function SectionCell({ row, width }: { row: TimelineRow; width: number }) {
  // A photo that will not load gives way to the coloured initial, as an avatar does.
  const [broken, setBroken] = useState(false);
  return (
    <div
      className="sticky left-0 z-10 flex shrink-0 items-center border-r border-b border-[#cecece] bg-white text-[13px] font-medium text-wz-strong"
      style={{ width }}
    >
      {row.id === null ? (
        <div className="w-full text-center">Unassigned</div>
      ) : (
        <div className="flex w-full min-w-0 items-center px-2">
          <div className="flex w-[70px] shrink-0 justify-center">
            {row.photoUrl && !broken ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={row.photoUrl}
                alt=""
                onError={() => setBroken(true)}
                className="size-11 rounded-full border-2 border-black/25 object-cover"
                style={{ backgroundColor: row.color }}
              />
            ) : (
              <div
                aria-hidden
                className="grid size-10 place-items-center rounded-full text-[22.1px] leading-[37.57px] font-medium text-white"
                style={{ backgroundColor: row.color }}
              >
                {row.name.trim().charAt(0).toUpperCase()}
              </div>
            )}
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate leading-5">{row.name}</div>
            {row.role ? <div className="truncate leading-[16.9px] text-[#888888]">{row.role}</div> : null}
          </div>
        </div>
      )}
    </div>
  );
}
