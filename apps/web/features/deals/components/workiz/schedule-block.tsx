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
import { clockInTz, DEFAULT_TZ, withZone, zoneAbbr, zonedInstant } from "@/lib/timezone";
import {
  endOf,
  slotTimes,
  withAllDay,
  withEndTime,
  withScheduled,
  withStartDate,
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
  // The end the user set by hand, theirs while the value still carries it:
  // Starts then moves without it, only never past it. Otherwise Starts
  // carries Ends along and the visit keeps its length (Workiz).
  const [handEnd, setHandEnd] = useState<string | null>(null);
  const endEdited = handEnd !== null && handEnd === endOf(value);
  const setEnd = (next: ScheduledValue) => {
    setHandEnd(endOf(next));
    onChange(next);
  };
  const shownEndDate = value.endDate || value.date;

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
          onChange={(date) => onChange(withStartDate(value, date, { endEdited }))}
        />
        {value.allDay ? <span /> : (
          <WzTimeSelect label="At" value={start} disabled={disabled} onChange={(t) => onChange(withStartTime(value, t, { endEdited }))} />
        )}
        <WzDateField
          label="Ends"
          min={value.date || undefined}
          value={shownEndDate}
          disabled={disabled}
          onChange={(endDate) => setEnd({ ...value, endDate })}
        />
        {value.allDay ? <span /> : (
          <WzTimeSelect label="At" value={end} disabled={disabled} onChange={(t) => setEnd(withEndTime({ ...value, endDate: shownEndDate }, t))} />
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

  const inputZone = scheduled ? inputZoneLabel(value, tz) : "";
  return (
    <section className={className} aria-label={title}>
      <WzSectionHeader action={toggle}>{title}</WzSectionHeader>
      {inputZone ? (
        // The time notice's type (11px/16px), under the header: which clock the inputs are on.
        <p data-testid="wz-zone-notice" className="-mt-3 mb-3 text-[11px] leading-4 text-foreground">
          Times in {inputZone}
        </p>
      ) : null}
      {fields}
    </section>
  );
}

/**
 * "It's 7:53 AM in Princeton" beside the card title (newJob-module__timeNotice:
 * 4px / 8px padding, 11px/16px, the time bold), ticking with the clock in the
 * job's zone. Workiz's markup carries a clock.svg that never paints
 * (new_12_client_picked_scroll0 shows none) — only its 4px gap survives, so
 * the words start 12px after the title.
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
      className="inline-flex items-center gap-1 pt-1 pl-3 align-top text-[11px] leading-4 font-normal text-foreground"
    >
      It&apos;s <b className="font-bold">{withZone(clockInTz(now, tz), now, tz)}</b> in {place}
    </span>
  );
}

/**
 * The zone a job's schedule inputs are on, when it is not Connecticut's
 * ("CDT"), else "". The inputs hold the visit as stored — the wall clock of
 * the zone it was booked in — while every other time on the web is
 * Connecticut's (2026-10-12 owner rule), so a job booked elsewhere says so.
 * Read at the visit's own start, so a winter visit says CST.
 */
export function inputZoneLabel(value: ScheduledValue, tz: string | undefined): string {
  if (!tz || !value.date || !/^\d{4}-\d{2}-\d{2}$/.test(value.date)) return "";
  const [start] = slotTimes(value.slot);
  const at = zonedInstant(value.date, /^\d{2}:\d{2}$/.test(start) ? start : "12:00", tz);
  const abbr = zoneAbbr(at, tz);
  return abbr && abbr !== zoneAbbr(at, DEFAULT_TZ) ? abbr : "";
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
