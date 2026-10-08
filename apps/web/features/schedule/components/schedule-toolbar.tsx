"use client";

import type { ReactNode } from "react";
import { CalendarClock, CalendarX2, ChevronLeft, ChevronRight, SlidersHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";
import { SCHEDULE_VIEWS, scheduleTitle, type ScheduleView } from "../calendar";

/**
 * The Schedule's top row (`._schTopNav`, pg_schedule_wz_10_toolbar): "Today",
 * ‹ ›, the period, then the five views and the icon buttons — Unscheduled
 * jobs (with its red count), Add time off, Filter results. 43px over a 1px
 * #ddd rule. Workiz also has a Schedule settings gear; we have no schedule
 * settings, so it is left out.
 */
export function ScheduleToolbar({
  view,
  date,
  onView,
  onToday,
  onStep,
  unscheduledCount,
  unscheduledOpen,
  onToggleUnscheduled,
  onAddTimeOff,
  filterOpen,
  onToggleFilter,
}: {
  view: ScheduleView;
  date: string;
  onView: (view: ScheduleView) => void;
  onToday: () => void;
  onStep: (dir: 1 | -1) => void;
  /** Undefined until the count is in. */
  unscheduledCount?: number;
  unscheduledOpen: boolean;
  onToggleUnscheduled: () => void;
  /** Absent for someone who may not add time off. */
  onAddTimeOff?: () => void;
  filterOpen: boolean;
  onToggleFilter: () => void;
}) {
  return (
    <div className="flex h-[43px] shrink-0 items-start border-b border-wz-frame px-4">
      {/* .dhx_cal_today_button: 72×32, 1px #cecece, 4px corners, 13px #2f3a48. */}
      <button
        type="button"
        onClick={onToday}
        className="h-8 w-[72px] shrink-0 rounded-[4px] border border-[#cecece] text-[13px] leading-[30px] text-[#2f3a48] hover:bg-wz-secondary-hover"
      >
        Today
      </button>
      <ArrowButton label="Previous" onClick={() => onStep(-1)}>
        <ChevronLeft className="size-[18px]" strokeWidth={1.5} />
      </ArrowButton>
      <ArrowButton label="Next" onClick={() => onStep(1)}>
        <ChevronRight className="size-[18px]" strokeWidth={1.5} />
      </ArrowButton>
      <h2 className="mt-1 ml-5 min-w-0 flex-1 truncate text-[16px] leading-[19px] font-normal text-wz-strong">
        {scheduleTitle(view, date)}
      </h2>

      {/* ._schViews: one 32px box of 12px/500 views, the chosen one #f8f8f8. */}
      <div role="tablist" aria-label="Schedule view" className="flex h-8 shrink-0 overflow-hidden rounded-[4px] border border-wz-frame">
        {SCHEDULE_VIEWS.map((v) => (
          <button
            key={v.value}
            type="button"
            role="tab"
            aria-selected={view === v.value}
            onClick={() => onView(v.value)}
            className={cn(
              "h-[30px] min-w-[70px] border-r border-wz-frame px-[10px] pt-[9px] pb-[7px] text-center text-[12px] leading-4 font-medium text-wz-strong last:border-r-0",
              view === v.value ? "bg-[#f8f8f8]" : "hover:bg-[#f8f8f8]",
            )}
          >
            {v.label}
          </button>
        ))}
      </div>

      <IconButton label="Unscheduled jobs" pressed={unscheduledOpen} onClick={onToggleUnscheduled} className="ml-[10px]">
        <CalendarClock className="size-[18px]" strokeWidth={1.5} />
        {unscheduledCount ? (
          <span className="absolute -top-[8px] -right-[8px] grid size-[18px] place-items-center rounded-full bg-wz-danger text-[12px] leading-none tracking-normal text-white">
            {unscheduledCount > 99 ? "99+" : unscheduledCount}
          </span>
        ) : null}
      </IconButton>
      {onAddTimeOff ? (
        <IconButton label="Add time off" onClick={onAddTimeOff} className="ml-2">
          <CalendarX2 className="size-[18px]" strokeWidth={1.5} />
        </IconButton>
      ) : null}
      <IconButton label="Filter results" pressed={filterOpen} onClick={onToggleFilter} className="ml-2">
        <SlidersHorizontal className="size-[18px]" strokeWidth={1.5} />
      </IconButton>
    </div>
  );
}

/** ‹ / ›: 30px round, 16px after the box before. */
function ArrowButton({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="ml-4 grid size-[30px] shrink-0 place-items-center rounded-full text-[#2f3a48] hover:bg-wz-secondary-hover"
    >
      {children}
    </button>
  );
}

/** `.schSettings`: a 32px square, 1px #cecece, 4px corners. */
function IconButton({
  label,
  pressed,
  onClick,
  className,
  children,
}: {
  label: string;
  pressed?: boolean;
  onClick: () => void;
  className?: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      onClick={onClick}
      className={cn(
        "relative grid size-8 shrink-0 place-items-center rounded-[4px] border border-[#cecece] text-foreground hover:bg-wz-secondary-hover",
        className,
      )}
    >
      {children}
    </button>
  );
}
