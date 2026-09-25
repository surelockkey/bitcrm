"use client";

import { useState } from "react";

export interface DailyPoint {
  date: string;
  value: number;
  /** The second series' value, when `series` names two. */
  compare?: number;
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
 * A column a day, on one scale (dataviz spec: ≤24px columns with a 4px
 * rounded end on a single baseline, a 2px gap, hairline grid, a tooltip on
 * hover and focus, and the same numbers as a table for screen readers).
 * With `series` naming two, each day carries a second column (`compare`)
 * beside the first and a legend names both — never a second axis.
 */
export function DailyChart({
  title,
  days,
  format,
  series,
  labelOf = dayLabel,
}: {
  title: string;
  days: DailyPoint[];
  format: (value: number) => string;
  series?: [string, string];
  /** A column's label — a day by default; a week or month reads its own. */
  labelOf?: (date: string) => string;
}) {
  const [active, setActive] = useState<number | null>(null);
  const pair = !!series;
  const top = niceMax(Math.max(0, ...days.flatMap((d) => [d.value, pair ? (d.compare ?? 0) : 0])));
  const empty = days.every((d) => d.value === 0 && (!pair || !d.compare));
  const ticks = [top, top / 2, 0];
  const labelAt = new Set([0, Math.floor((days.length - 1) / 2), days.length - 1]);

  return (
    <figure className="flex flex-col gap-2">
      {series && (
        <ul aria-label="Legend" className="flex gap-4 text-xs text-muted-foreground">
          {series.map((name, i) => (
            <li key={name} className="flex items-center gap-1.5">
              <span className={`size-2.5 rounded-sm ${i === 0 ? "bg-brand" : "bg-chart2"}`} aria-hidden />
              {name}
            </li>
          ))}
        </ul>
      )}
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
                const comparePct = ((d.compare ?? 0) / top) * 100;
                const dim = { opacity: active === null || active === i ? 1 : 0.55 };
                const said = pair
                  ? `${labelOf(d.date)}: ${series![0]} ${format(d.value)}, ${series![1]} ${format(d.compare ?? 0)}`
                  : `${labelOf(d.date)}: ${format(d.value)}`;
                return (
                  <div
                    key={d.date}
                    data-testid="daily-hit"
                    tabIndex={0}
                    aria-label={said}
                    className="relative flex h-full flex-1 items-end justify-center gap-[2px] outline-none focus-visible:bg-accent"
                    onMouseEnter={() => setActive(i)}
                    onMouseLeave={() => setActive(null)}
                    onFocus={() => setActive(i)}
                    onBlur={() => setActive(null)}
                  >
                    <div
                      data-testid="daily-bar"
                      data-height={Number(pct.toFixed(4))}
                      className={`w-full rounded-t-[4px] bg-brand ${pair ? "max-w-3" : "max-w-6"}`}
                      style={{ height: `${pct}%`, ...dim }}
                    />
                    {pair && (
                      <div
                        data-testid="daily-bar-compare"
                        data-height={Number(comparePct.toFixed(4))}
                        className="w-full max-w-3 rounded-t-[4px] bg-chart2"
                        style={{ height: `${comparePct}%`, ...dim }}
                      />
                    )}
                    {active === i && (
                      <div
                        role="tooltip"
                        className="absolute bottom-full z-10 mb-1 whitespace-nowrap rounded-md border border-border bg-popover px-2 py-1 text-xs shadow-sm"
                      >
                        <span className="text-muted-foreground">{labelOf(d.date)}</span>{" "}
                        {pair ? (
                          <>
                            <span className="text-foreground">
                              {series![0]} <span className="font-medium">{format(d.value)}</span>
                            </span>{" "}
                            <span className="text-foreground">
                              {series![1]} <span className="font-medium">{format(d.compare ?? 0)}</span>
                            </span>
                          </>
                        ) : (
                          <span className="font-medium text-foreground">{format(d.value)}</span>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            <div className="mt-1 flex text-xs text-muted-foreground" aria-hidden>
              {days.map((d, i) => (
                <span key={d.date} className="flex-1 whitespace-nowrap text-center">
                  {labelAt.has(i) ? labelOf(d.date) : ""}
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
            <th scope="col">{series?.[0] ?? "Value"}</th>
            {series && <th scope="col">{series[1]}</th>}
          </tr>
        </thead>
        <tbody>
          {days.map((d) => (
            <tr key={d.date}>
              <td>{labelOf(d.date)}</td>
              <td>{format(d.value)}</td>
              {series && <td>{format(d.compare ?? 0)}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
