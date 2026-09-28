"use client";

import { useState } from "react";

export interface DailySeries {
  label: string;
  /** The column's fill, as a background utility — `bg-brand`, `bg-chart2`, … */
  className: string;
}

export interface DailyPoint {
  date: string;
  /** One number per series, in the order `series` names them. */
  values: number[];
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
 *
 * With more than one series, each day carries a column per series side by
 * side and a legend names them — never a second axis. Colour is the caller's:
 * a comparison reaches for the categorical slots (`bg-brand`, `bg-chart2`),
 * a breakdown by state for the status fills, and neither is generated here,
 * so a series keeps its colour when a filter drops one of its neighbours.
 */
export function DailyChart({
  title,
  days,
  series,
  format,
  labelOf = dayLabel,
}: {
  title: string;
  days: DailyPoint[];
  /** One entry per column in a day's group; a single entry draws no legend. */
  series: DailySeries[];
  format: (value: number) => string;
  /** A column's label — a day by default; a week or month reads its own. */
  labelOf?: (date: string) => string;
}) {
  const [active, setActive] = useState<number | null>(null);
  const many = series.length > 1;
  const valueAt = (d: DailyPoint, i: number) => d.values[i] ?? 0;
  const top = niceMax(Math.max(0, ...days.flatMap((d) => series.map((_, i) => valueAt(d, i)))));
  const empty = days.every((d) => series.every((_, i) => valueAt(d, i) === 0));
  const ticks = [top, top / 2, 0];
  const labelAt = new Set([0, Math.floor((days.length - 1) / 2), days.length - 1]);
  // One column is allowed to be wide; a group of them has to stay thin enough
  // that the 2px trench between days still reads as the bigger gap.
  const barWidth = many ? "max-w-3" : "max-w-6";

  return (
    <figure className="flex flex-col gap-2">
      {many && (
        <ul aria-label="Legend" className="flex flex-wrap gap-4 text-xs text-muted-foreground">
          {series.map((s) => (
            <li key={s.label} className="flex items-center gap-1.5">
              <span className={`size-2.5 rounded-sm ${s.className}`} aria-hidden />
              {s.label}
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
                const dim = { opacity: active === null || active === i ? 1 : 0.55 };
                const said = `${labelOf(d.date)}: ${series
                  .map((s, si) => `${s.label} ${format(valueAt(d, si))}`)
                  .join(", ")}`;
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
                    {series.map((s, si) => {
                      const pct = (valueAt(d, si) / top) * 100;
                      return (
                        <div
                          key={s.label}
                          data-testid="daily-bar"
                          data-series={s.label}
                          data-height={Number(pct.toFixed(4))}
                          className={`w-full rounded-t-[4px] ${barWidth} ${s.className}`}
                          style={{ height: `${pct}%`, ...dim }}
                        />
                      );
                    })}
                    {active === i && (
                      <div
                        role="tooltip"
                        className="absolute bottom-full z-10 mb-1 whitespace-nowrap rounded-md border border-border bg-popover px-2 py-1 text-xs shadow-sm"
                      >
                        <span className="text-muted-foreground">{labelOf(d.date)}</span>{" "}
                        {many ? (
                          series.map((s, si) => (
                            <span key={s.label} className="text-foreground">
                              {s.label} <span className="font-medium">{format(valueAt(d, si))}</span>{" "}
                            </span>
                          ))
                        ) : (
                          <span className="font-medium text-foreground">{format(valueAt(d, 0))}</span>
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
            {series.map((s) => (
              <th key={s.label} scope="col">
                {s.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {days.map((d) => (
            <tr key={d.date}>
              <td>{labelOf(d.date)}</td>
              {series.map((s, si) => (
                <td key={s.label}>{format(valueAt(d, si))}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
