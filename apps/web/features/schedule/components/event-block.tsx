"use client";

import { useEffect, useRef, type CSSProperties, type ReactNode } from "react";
import { useDraggable } from "@dnd-kit/core";
import { TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { DONE_STRIPES } from "../geometry";
import type { DragSource } from "../reschedule";

/*
 * The calendar's jobs as Workiz's DHTMLX scheduler draws them
 * (pg_schedule_wz_01/04/05/06/07): solid in the job's colour behind a 1px
 * white edge with 4px corners and white words; a Done job under grey stripes
 * at 70%. No hover card — Workiz shows none.
 */

function fill(color: string, done: boolean): CSSProperties {
  return done
    ? { backgroundColor: color, backgroundImage: DONE_STRIPES, backgroundSize: "56.57px 56.57px", opacity: 0.7 }
    : { backgroundColor: color };
}

/** A box in the Day/Week hours: "Job ID: X" over the template text (`.dhx_cal_event`). */
export function EventBox({
  color,
  done = false,
  title,
  text,
  conflict = false,
}: {
  color: string;
  done?: boolean;
  title: string;
  text: string;
  conflict?: boolean;
}) {
  return (
    <div
      data-slot="schedule-event"
      className="h-full w-full overflow-hidden rounded-[4px] border border-white text-white"
      style={fill(color, done)}
    >
      {/* .dhx_title: 12px/14px bold, 8px 6px 5px 10px; the pointer says it opens the job. */}
      <div className="flex cursor-pointer items-start gap-1 pt-2 pr-[6px] pb-[5px] pl-[10px] text-[12px] leading-[14px] font-bold">
        <span className="min-w-0">{title}</span>
        {conflict ? <TriangleAlert aria-label="Schedule conflict" className="size-3 shrink-0" /> : null}
      </div>
      {/* .dhx_body: 13px/16.9px medium, 0 10px; the template's line breaks fold like Workiz's. */}
      <div className="px-[10px] text-[13px] leading-[16.9px] font-medium">{text}</div>
    </div>
  );
}

/**
 * A bar — the all-day / multi-day strip, the Timeline, a job running over
 * days in the Month (`.dhx_cal_event_line`): 13px/16.9px medium on one line.
 * `tall` is the Timeline's 22px bar with its words 5px down.
 */
export function EventBar({
  color,
  done = false,
  text,
  tall = false,
  conflict = false,
}: {
  color: string;
  done?: boolean;
  text: string;
  tall?: boolean;
  conflict?: boolean;
}) {
  return (
    <div
      data-slot="schedule-event"
      className={cn(
        "flex h-full w-full items-start gap-1 overflow-hidden rounded-[4px] border border-white pl-[10px] text-[13px] leading-[16.9px] font-medium whitespace-nowrap text-white",
        tall && "pt-[4px]",
      )}
      style={fill(color, done)}
    >
      {conflict ? <TriangleAlert aria-label="Schedule conflict" className="mt-[2px] size-3 shrink-0" /> : null}
      <span className="min-w-0">{text}</span>
    </div>
  );
}

/** A timed job in a Month day (`.dhx_cal_event_clear`): a 10px dot, the start in bold, the words. */
export function MonthLine({ color, done = false, time, text }: { color: string; done?: boolean; time: string; text: string }) {
  return (
    <div
      data-slot="schedule-event"
      className="flex h-5 items-start overflow-hidden pl-[2px] text-[12px] whitespace-nowrap text-wz-strong"
      style={done ? { opacity: 0.7 } : undefined}
    >
      <span aria-hidden className="mt-[3px] ml-[3px] size-[10px] shrink-0 rounded-full" style={{ backgroundColor: color }} />
      <span className="ml-1 font-bold">{time}</span>
      <span className="min-w-0">&nbsp;{text}</span>
    </div>
  );
}

/**
 * Something on the calendar that can be picked up. Workiz moves the job
 * itself under the pointer at 70%, snapping to the grid (09_week_dragging);
 * `snap` gives the step on each axis. A click that was not a drag opens it.
 */
export function Draggable({
  id,
  source,
  disabled,
  label,
  className,
  style,
  snap,
  onOpen,
  children,
}: {
  id: string;
  source: DragSource;
  disabled: boolean;
  label: string;
  className?: string;
  style?: CSSProperties;
  snap?: { x?: number; y?: number };
  onOpen?: () => void;
  children: ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id, data: source, disabled });
  // The click that ends a drag is not a request to open the job.
  const dragged = useRef(false);
  useEffect(() => {
    if (isDragging) dragged.current = true;
  }, [isDragging]);

  const step = (v: number, s?: number) => (s ? Math.round(v / s) * s : v);
  const t = transform ? { x: step(transform.x, snap?.x), y: step(transform.y, snap?.y) } : null;

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      aria-label={label}
      onClick={() => {
        if (dragged.current) {
          dragged.current = false;
          return;
        }
        onOpen?.();
      }}
      className={cn("absolute", !disabled && "touch-none", isDragging && "z-50 opacity-70", className)}
      style={{ ...style, transform: t ? `translate3d(${t.x}px, ${t.y}px, 0)` : undefined }}
    >
      {children}
    </div>
  );
}
