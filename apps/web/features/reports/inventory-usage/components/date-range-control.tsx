"use client";

import { useId } from "react";
import { Input } from "@/components/ui/input";
import { RANGE_PRESETS, type RangePreset } from "../params";
import { rangeLabel } from "../format";

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * A browser's date field reports each keystroke of the year ("0002-07-15",
 * "0020-…", "0202-…") before the year is whole; asking the server about the
 * year 202 would be a wasted request at best. A day counts once it is a real
 * one in a plausible year.
 */
const plausible = (day: string): boolean => DAY.test(day) && day >= "2000-01-01" && day <= "2099-12-31";

/**
 * Workiz's date corner: the preset, the window spelled out, and its From / To
 * days. The days are always there — the box keeps one height whatever the
 * preset — and editing one turns the range into Custom.
 */
export function DateRangeControl({
  preset,
  from,
  to,
  onPreset,
  onDays,
}: {
  preset: RangePreset;
  from: string;
  to: string;
  onPreset: (preset: RangePreset) => void;
  onDays: (days: { from: string; to: string }) => void;
}) {
  const fromId = useId();
  const toId = useId();

  return (
    <div className="flex w-full flex-col gap-2 rounded-md border bg-card p-3 sm:w-[22rem]">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <select
          aria-label="Date range"
          className="h-8 rounded-md border bg-transparent px-2 text-sm"
          value={preset}
          onChange={(e) => onPreset(e.target.value as RangePreset)}
        >
          {RANGE_PRESETS.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </select>
        <span className="text-sm font-medium tabular-nums">{rangeLabel(from, to)}</span>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="flex flex-col gap-1">
          <label htmlFor={fromId} className="text-xs text-muted-foreground">
            From
          </label>
          <Input
            id={fromId}
            type="date"
            className="h-8"
            value={from}
            max={to}
            onChange={(e) => plausible(e.target.value) && onDays({ from: e.target.value, to })}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor={toId} className="text-xs text-muted-foreground">
            To
          </label>
          <Input
            id={toId}
            type="date"
            className="h-8"
            value={to}
            min={from}
            onChange={(e) => plausible(e.target.value) && onDays({ from, to: e.target.value })}
          />
        </div>
      </div>
    </div>
  );
}
