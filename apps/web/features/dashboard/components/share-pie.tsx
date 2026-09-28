"use client";

import { useState } from "react";
import type { DashboardShare } from "@bitcrm/types";
import { cn } from "@/lib/utils";
import { pieSlices } from "../charts";

/**
 * The categorical slots in their validated order (see `lib/theme/tokens.ts`).
 * A pie holds four, so it takes the first four.
 */
const SLOTS = [
  { fill: "fill-brand", border: "border-brand", swatch: "bg-brand" },
  { fill: "fill-chart2", border: "border-chart2", swatch: "bg-chart2" },
  { fill: "fill-chart3", border: "border-chart3", swatch: "bg-chart3" },
  { fill: "fill-chart4", border: "border-chart4", swatch: "bg-chart4" },
] as const;

/**
 * A pie of up to four slices and, under it, Workiz's two-by-two legend: each
 * slice's name over its percent, the left column ruled on the left and the
 * right column on the right.
 *
 * The name sits beside every colour, so identity never rests on colour alone —
 * which also carries the three slots that fall under 3:1 on white. Wedges are
 * split by a 2px ring of the card colour, answer hover and focus with their
 * numbers, and the whole thing is a table for screen readers.
 */
export function SharePie({ title, slices }: { title: string; slices: DashboardShare[] }) {
  const [active, setActive] = useState<number | null>(null);
  if (!slices.length) {
    return <p className="py-10 text-center text-sm text-muted-foreground">No data to display.</p>;
  }
  const wedges = pieSlices(slices.map((s) => s.count));
  const shown = active === null ? null : slices[active];

  return (
    <figure className="flex flex-col gap-4">
      <div className="relative mx-auto size-28">
        <svg viewBox="-2 -2 104 104" className="size-full" aria-hidden>
          {wedges.map((w, i) => (
            <path
              key={slices[i].key}
              data-testid="pie-slice"
              d={w.path}
              className={cn(SLOTS[i % SLOTS.length].fill, "stroke-card outline-none")}
              strokeWidth={2}
              strokeLinejoin="round"
              style={{ opacity: active === null || active === i ? 1 : 0.55 }}
              tabIndex={0}
              onMouseEnter={() => setActive(i)}
              onMouseLeave={() => setActive(null)}
              onFocus={() => setActive(i)}
              onBlur={() => setActive(null)}
            />
          ))}
        </svg>
        {shown ? (
          <div
            role="tooltip"
            className="absolute top-full left-1/2 z-10 mt-1 -translate-x-1/2 whitespace-nowrap rounded-md border border-border bg-popover px-2 py-1 text-xs shadow-sm"
          >
            <span className="text-muted-foreground">{shown.name}</span>{" "}
            <span className="font-medium text-foreground">
              {shown.count.toLocaleString("en-US")} {shown.count === 1 ? "job" : "jobs"} · {shown.percent}%
            </span>
          </div>
        ) : null}
      </div>

      <ul aria-label="Legend" className="grid grid-cols-2 gap-x-6 gap-y-4">
        {slices.map((s, i) => {
          const right = i % 2 === 1;
          return (
            <li
              key={s.key}
              className={cn(
                "flex min-w-0 flex-col gap-0.5",
                SLOTS[i % SLOTS.length].border,
                right ? "items-end border-r-4 pr-3 text-right" : "border-l-4 pl-3",
              )}
            >
              <span className="w-full truncate text-xs text-muted-foreground" title={s.name}>
                {s.name}
              </span>
              <span className="text-2xl font-light tabular-nums text-foreground">{s.percent.toFixed(2)}%</span>
            </li>
          );
        })}
      </ul>

      {/* The wrapper is what hides: a table never shrinks below its content,
          so `sr-only` on the table itself would widen the page. */}
      <div className="sr-only">
        <table aria-label={title}>
          <thead>
            <tr>
              <th scope="col">Name</th>
              <th scope="col">Jobs</th>
              <th scope="col">Share</th>
            </tr>
          </thead>
          <tbody>
            {slices.map((s) => (
              <tr key={s.key}>
                <td>{s.name}</td>
                <td>{s.count}</td>
                <td>{s.percent}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </figure>
  );
}
