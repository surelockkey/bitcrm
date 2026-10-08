"use client";

import { useEffect, useState, type ReactNode } from "react";
import {
  WzCalendarOutlineIcon,
  WzCard,
  WzCheckbox,
  WzDateField,
  WzSectionHeader,
  WzSwitch,
  WzTimeSelect,
} from "@/components/workiz";
import { cn } from "@/lib/utils";
import { clockInTz, DEFAULT_TZ } from "@/lib/timezone";
import {
  slotTimes,
  withAllDay,
  withEndTime,
  withScheduled,
  withStartTime,
  type ScheduledValue,
} from "../scheduled-block";

export interface WzScheduleBlockProps {
  /**
   * "card": New Job's "Scheduled" card (287px columns, the clock beside the
   * title, the team select under it as `children`). "section": the job
   * page's "Schedule" section (217px columns, View schedule beside All-day).
   */
  layout: "card" | "section";
  value: ScheduledValue;
  onChange: (next: ScheduledValue) => void;
  /** The job's timezone (its service area's); the clock and a fresh schedule use it. */
  tz?: string;
  /** Where the job is ("Princeton"): with it the card shows "It's 7:53 AM in Princeton". */
  place?: string;
  disabled?: boolean;
  /** "View schedule" on the section's All-day row (the card puts it under the team). */
  viewScheduleHref?: string;
  /** Card only: what follows the schedule — "Assign team members" and its notice. */
  children?: ReactNode;
  className?: string;
}

/**
 * Workiz's schedule block over our schedule rules (`scheduled-block.tsx`):
 * the green switch (off = unscheduled, on again = from now in the job's
 * zone), Starts + At and Ends + At, All-day. Emits the whole value, which
 * maps onto the deal's scheduledDate / scheduledEndDate / scheduledTimeSlot /
 * allDay exactly as the old block's did. No recurring schedule: we have none.
 */
export function WzScheduleBlock({
  layout,
  value,
  onChange,
  tz,
  place,
  disabled = false,
  viewScheduleHref,
  children,
  className,
}: WzScheduleBlockProps) {
  const card = layout === "card";
  const title = card ? "Scheduled" : "Schedule";
  const scheduled = Boolean(value.date);
  const [start, end] = slotTimes(value.slot);

  const toggle = (
    <WzSwitch
      aria-label={title}
      checked={scheduled}
      disabled={disabled}
      onCheckedChange={(on) => onChange(withScheduled(value, on, tz))}
    />
  );

  const fields = scheduled ? (
    <>
      {/* new_12 / job_b_01_details: two rows 24px apart; date 40px, time 42px. */}
      <div
        className={cn(
          "grid justify-between gap-y-6",
          card ? "grid-cols-[287px_287px]" : "grid-cols-[217px_217px]",
        )}
      >
        <WzDateField
          label="Starts"
          value={value.date}
          disabled={disabled}
          onChange={(date) => onChange({ ...value, date })}
        />
        {value.allDay ? <span /> : (
          <WzTimeSelect label="At" value={start} disabled={disabled} onChange={(t) => onChange(withStartTime(value, t))} />
        )}
        <WzDateField
          label="Ends"
          min={value.date || undefined}
          value={value.endDate || value.date}
          disabled={disabled}
          onChange={(endDate) => onChange({ ...value, endDate })}
        />
        {value.allDay ? <span /> : (
          <WzTimeSelect label="At" value={end} disabled={disabled} onChange={(t) => onChange(withEndTime(value, t))} />
        )}
      </div>
      {/* The card's row sits 34px under the times (Workiz keeps "Set recurring
          schedule" at its left, which we do not have); the section's 24px,
          with View schedule at its right. */}
      <div className={cn("flex items-start", card ? "mt-[34px] justify-end" : "mt-6 justify-between")}>
        <WzCheckbox
          label="All-day event"
          checked={value.allDay}
          disabled={disabled}
          onCheckedChange={(on) => onChange(withAllDay(value, on))}
        />
        {!card && viewScheduleHref ? <WzViewSchedule href={viewScheduleHref} /> : null}
      </div>
    </>
  ) : !card && viewScheduleHref ? (
    <div className="flex justify-end">
      <WzViewSchedule href={viewScheduleHref} />
    </div>
  ) : null;

  if (card) {
    return (
      <WzCard
        title={
          <>
            Scheduled
            {place ? <WzTimeNotice tz={tz} place={place} /> : null}
          </>
        }
        action={toggle}
        className={className}
        contentClassName="gap-0 pt-0"
      >
        {fields}
        {children ? <div className={scheduled ? "mt-5" : undefined}>{children}</div> : null}
      </WzCard>
    );
  }

  return (
    <section className={className} aria-label={title}>
      <WzSectionHeader action={toggle}>{title}</WzSectionHeader>
      {fields}
    </section>
  );
}

/**
 * "It's 7:53 AM in Princeton" beside the card title (newJob-module__timeNotice:
 * Workiz's clock.svg, 4px gap, 4px / 8px padding, 11px/16px, the time bold),
 * ticking with the clock in the job's zone.
 */
export function WzTimeNotice({ tz = DEFAULT_TZ, place }: { tz?: string; place: string }) {
  const [now, setNow] = useState(() => new Date().toISOString());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date().toISOString()), 30_000);
    return () => clearInterval(id);
  }, []);
  return (
    <span
      data-testid="wz-time-notice"
      className="inline-flex items-center gap-1 pt-1 pl-2 align-top text-[11px] leading-4 font-normal text-foreground"
    >
      <WzClockIcon />
      It&apos;s <b className="font-bold">{clockInTz(now, tz)}</b> in {place}
    </span>
  );
}

/** Workiz's clock.svg (assets.workiz.com/latest/_assets/svg/clock.svg), 14px, ink. */
function WzClockIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden className="shrink-0">
      <path
        d="M1 7a6 6 0 1 0 12 0A6 6 0 0 0 1 7Z"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M9.652 7H7V4.348" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/**
 * Workiz's outline "View schedule" pill (Button-module secondary, regular,
 * with its calendar glyph) as a link to our Schedule, opened in a new tab so
 * the form being filled in stays as it is.
 */
export function WzViewSchedule({ href, className }: { href: string; className?: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      data-slot="wz-button"
      data-variant="secondary"
      className={cn(
        // Not shrink-0: beside a long team notice Workiz's pill gives way and
        // its words wrap ("View / schedule", new_12_client_picked_scroll0).
        "relative inline-flex max-h-10 min-w-0 cursor-pointer flex-row items-center justify-center gap-1 rounded-pill px-3 py-[6.5px] outline-none transition-colors",
        "border border-foreground bg-transparent hover:bg-wz-secondary-hover active:bg-wz-secondary-active focus-visible:ring-2 focus-visible:ring-wz-focus",
        className,
      )}
    >
      <span
        data-slot="wz-button-icon"
        className="relative flex size-[19px] items-center justify-center text-[13px] text-foreground [&_svg]:size-[15px] [&_svg]:shrink-0"
      >
        <WzCalendarOutlineIcon />
      </span>
      <span className="flex items-center px-1 text-center text-[13px] leading-[19px] font-semibold tracking-[0.2px] text-foreground">
        View schedule
      </span>
    </a>
  );
}
