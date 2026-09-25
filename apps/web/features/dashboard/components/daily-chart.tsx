"use client";

import { useState } from "react";

export interface DailyPoint {
  date: string;
  value: number;
}

/** 1 / 2 / 5 × 10ⁿ at or above `max` — the top of the axis. */
function niceMax(max: number): number {
  if (max <= 0) return 1;
  const pow = 10 ** Math.floor(Math.log10(max));
  const step = [1, 2, 5, 10].find((s) => s * pow >= max) ?? 10;
  return step * pow;
}

const dayLabel = (date: string): string =>
  new Date(`${date}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

/**
 * One series, one column a day (dataviz spec: ≤24px columns with a 4px
 * rounded end on a single baseline, a 2px gap, hairline grid, a tooltip on
 * hover and focus, and the same numbers as a table for screen readers).
 */
export function DailyChart({
  title,
  days,
  format,
}: {
  title: string;
  days: DailyPoint[];
  format: (value: number) => string;
}) {
  const [active, setActive] = useState<number | null>(null);
  const top = niceMax(Math.max(0, ...days.map((d) => d.value)));
  const empty = days.every((d) => d.value === 0);
  const ticks = [top, top / 2, 0];
  const labelAt = new Set([0, Math.floor((days.length - 1) / 2), days.length - 1]);

  return (
    <figure className="flex flex-col gap-2">
      {empty ? (
        <p className="py-10 text-center text-sm text-muted-foreground">No data to display.</p>
      ) : (
        <div className="flex gap-2">
          <div className="flex h-40 flex-col justify-between text-right text-xs tabular-nums text-muted-foreground" aria-hidden>
            {ticks.map((t) => (
              <span key={t} className="-translate-y-1/2 first:translate-y-0 last:translate-y-0">
                {format(t)}
              </span>
            ))}
          </div>
          <div className="relative flex-1">
            <div className="pointer-events-none absolute inset-0 flex h-40 flex-col justify-between" aria-hidden>
              {ticks.map((t) => (
                <div key={t} className="border-t border-border" />
              ))}
            </div>
            <div className="relative flex h-40 items-end gap-[2px]">
              {days.map((d, i) => {
                const pct = (d.value / top) * 100;
                return (
                  <div
                    key={d.date}
                    data-testid="daily-hit"
                    tabIndex={0}
                    aria-label={`${dayLabel(d.date)}: ${format(d.value)}`}
                    className="relative flex h-full flex-1 items-end justify-center outline-none focus-visible:bg-accent"
                    onMouseEnter={() => setActive(i)}
                    onMouseLeave={() => setActive(null)}
                    onFocus={() => setActive(i)}
                    onBlur={() => setActive(null)}
                  >
                    <div
                      data-testid="daily-bar"
                      data-height={Number(pct.toFixed(4))}
                      className="w-full max-w-6 rounded-t-[4px] bg-brand"
                      style={{ height: `${pct}%`, opacity: active === null || active === i ? 1 : 0.55 }}
                    />
                    {active === i && (
                      <div
                        role="tooltip"
                        className="absolute bottom-full z-10 mb-1 whitespace-nowrap rounded-md border border-border bg-popover px-2 py-1 text-xs shadow-sm"
                      >
                        <span className="text-muted-foreground">{dayLabel(d.date)}</span>{" "}
                        <span className="font-medium text-foreground">{format(d.value)}</span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            <div className="mt-1 flex text-xs text-muted-foreground" aria-hidden>
              {days.map((d, i) => (
                <span key={d.date} className="flex-1 whitespace-nowrap text-center">
                  {labelAt.has(i) ? dayLabel(d.date) : ""}
                </span>
              ))}
            </div>
          </div>
        </div>
      )}
      <table className="sr-only" aria-label={title}>
        <thead>
          <tr>
            <th scope="col">Day</th>
            <th scope="col">Value</th>
          </tr>
        </thead>
        <tbody>
          {days.map((d) => (
            <tr key={d.date}>
              <td>{dayLabel(d.date)}</td>
              <td>{format(d.value)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
