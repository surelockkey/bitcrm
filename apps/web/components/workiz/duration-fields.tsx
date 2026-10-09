"use client";

import { useMemo } from "react";

import { cn } from "@/lib/utils";
import { WzSelect, type WzOption } from "./select";

/*
 * Workiz's Duration on a job type (pg_settings_catalogs_wz_jobtypes_add_open,
 * feat_job_rules_wz_jobtype_{days,hours,minutes}_open): three react-selects
 * in a row — Days 0–31, Hours 0–23, Minutes 0–59 — each 137×49 (1px #ccc,
 * 4px corners, the value 16px #333 11px in, a chevron) under its own 12px/16px
 * bold #666 label 3px above, 10px between the boxes, and the 11px/13px #999
 * "How long does this type of job usually take?" right under them.
 */

const DAYS = range(32);
const HOURS = range(24);
const MINUTES = range(60);

function range(n: number): WzOption[] {
  return Array.from({ length: n }, (_, i) => ({ value: String(i), label: String(i) }));
}

export interface WzDurationFieldsProps {
  /** The whole length, in minutes. */
  value: number;
  onChange: (minutes: number) => void;
  disabled?: boolean;
  /** Workiz's line under the boxes; pass `null` for none. */
  helper?: string | null;
  className?: string;
}

/** Days / Hours / Minutes as Workiz's job-type modal draws them; reports the whole length in minutes. */
export function WzDurationFields({
  value,
  onChange,
  disabled,
  helper = "How long does this type of job usually take?",
  className,
}: WzDurationFieldsProps) {
  const parts = useMemo(() => {
    const total = Math.max(0, Math.round(value || 0));
    return { days: Math.floor(total / 1440), hours: Math.floor((total % 1440) / 60), minutes: total % 60 };
  }, [value]);
  const emit = (next: Partial<typeof parts>) => {
    const p = { ...parts, ...next };
    onChange(p.days * 1440 + p.hours * 60 + p.minutes);
  };
  const boxes: { key: keyof typeof parts; label: string; options: WzOption[] }[] = [
    { key: "days", label: "Days", options: DAYS },
    { key: "hours", label: "Hours", options: HOURS },
    { key: "minutes", label: "Minutes", options: MINUTES },
  ];

  return (
    <div data-slot="wz-duration-fields" className={cn("flex flex-col", className)}>
      <div className="flex gap-2.5">
        {boxes.map((box) => (
          <div key={box.key} className="w-[137px]">
            {/* The words over the box; the select names itself for the screen reader. */}
            <span aria-hidden className="block text-xs leading-4 font-bold text-wz-text">
              {box.label}
            </span>
            <WzSelect
              label={box.label}
              geometry="bare"
              searchable={false}
              options={box.options}
              value={String(parts[box.key])}
              disabled={disabled}
              onChange={(v) => emit({ [box.key]: Number(v) || 0 })}
              className="mt-[3px]"
            />
          </div>
        ))}
      </div>
      {helper ? <small className="block text-[11px] leading-4 text-wz-caption">{helper}</small> : null}
    </div>
  );
}
