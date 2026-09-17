"use client";

import { useState } from "react";
import { joinOffset, splitOffset, type OffsetUnit } from "../../lib";

/** How many minutes one of a unit is — `joinOffset` is the only table of it. */
const unitMinutes = (unit: OffsetUnit): number => joinOffset({ value: 1, unit, direction: "after" });

export interface OffsetParts {
  /** The number in the box, in `unit`s. */
  value: number;
  unit: OffsetUnit;
  direction: "before" | "after";
  /** Sets the unit and hands back the minutes that keeps the number on screen. */
  withUnit: (unit: OffsetUnit) => number;
  withDirection: (direction: "before" | "after") => number;
  /** The minutes a freshly typed number means, in the unit and direction on screen. */
  withValue: (value: number) => number;
}

/**
 * `-240` shown as `4` `hours` `ahead of`, and written back as `-240`.
 *
 * The spec stores one signed number, and a number cannot say which unit it
 * was written in: `splitOffset(0)` can only answer "0 minutes, after", so a
 * box cleared to retype 4 in it would silently turn "4 hours ahead" into "4
 * minutes after". The unit and the direction are therefore remembered here
 * while the panel is open — they are how the number is *shown*, not part of
 * the rule — and the number itself is always read back off the spec, so the
 * two can never drift apart.
 */
export function useOffsetParts(minutes: number | undefined): OffsetParts {
  const seed = splitOffset(minutes);
  const [unit, setUnit] = useState<OffsetUnit>(seed.unit);
  const [direction, setDirection] = useState<"before" | "after">(seed.direction);
  const value = Math.abs(minutes ?? 0) / unitMinutes(unit);

  return {
    value,
    unit,
    direction,
    withUnit: (next) => {
      setUnit(next);
      // The number stays put and the span changes: 4 hours becomes 4 days,
      // which is what picking "days" beside a 4 asks for.
      return joinOffset({ value, unit: next, direction });
    },
    withDirection: (next) => {
      setDirection(next);
      return joinOffset({ value, unit, direction: next });
    },
    withValue: (next) => joinOffset({ value: next, unit, direction }),
  };
}
