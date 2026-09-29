"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { linePoints, niceMax } from "../charts";

/** The eight categorical slots, in their validated order (`lib/theme/tokens.ts`). */
const SLOTS = [
  { stroke: "stroke-brand", swatch: "bg-brand", ring: "border-brand" },
  { stroke: "stroke-chart2", swatch: "bg-chart2", ring: "border-chart2" },
  { stroke: "stroke-chart3", swatch: "bg-chart3", ring: "border-chart3" },
  { stroke: "stroke-chart4", swatch: "bg-chart4", ring: "border-chart4" },
  { stroke: "stroke-chart5", swatch: "bg-chart5", ring: "border-chart5" },
  { stroke: "stroke-chart6", swatch: "bg-chart6", ring: "border-chart6" },
  { stroke: "stroke-chart7", swatch: "bg-chart7", ring: "border-chart7" },
  { stroke: "stroke-chart8", swatch: "bg-chart8", ring: "border-chart8" },
] as const;

/** The plot's own coordinate space; it is stretched to the card. */
const W = 1000;
const H = 160;

export interface LineSeries {
  name: string;
  values: number[];
}

/**
 * A line per series over a run of days, on one axis.
 *
 * The plot is SVG stretched to the card, so its lines keep a 2px stroke with
 * `non-scaling-stroke`; anything that must stay round — the markers — is HTML
 * placed by percentage over it, and so are the axis labels. Hover (or focus)
 * a day to get the crosshair, a marker on every line and a tooltip with every
 * series' count. A legend names each line, and the numbers are also a table.
 */
export function LineChart({
  title,
  days,
  series,
  labelOf,
}: {
  title: string;
  days: string[];
  series: LineSeries[];
  labelOf: (day: string) => string;
}) {
  const [active, setActive] = useState<number | null>(null);
  if (!series.length) {
    return <p className="py-10 text-center text-sm text-muted-foreground">No data to display.</p>;
  }
  const top = niceMax(Math.max(0, ...series.flatMap((s) => s.values)));
  const ticks = [top, top / 2, 0];
  const lines = series.map((s) => linePoints(s.values, { width: W, height: H, top }));
  const labelAt = new Set([0, Math.floor((days.length - 1) / 2), days.length - 1]);
  const xPct = (i: number) => (days.length > 1 ? (i / (days.length - 1)) * 100 : 50);

  return (
    <figure className="flex flex-col gap-3">
      <ul aria-label="Legend" className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        {series.map((s, i) => (
          <li key={s.name} className="flex max-w-48 items-center gap-1.5">
            <span className={cn("size-2.5 shrink-0 rounded-full", SLOTS[i % SLOTS.length].swatch)} aria-hidden />
            <span className="truncate" title={s.name}>
              {s.name}
            </span>
          </li>
        ))}
      </ul>

      <div className="flex gap-2">
        <div
          className="flex h-40 flex-col justify-between text-right text-xs tabular-nums text-muted-foreground"
          aria-hidden
        >
          {ticks.map((t) => (
            <span key={t} className="-translate-y-1/2 first:translate-y-0 last:translate-y-0">
              {t.toLocaleString("en-US")}
            </span>
          ))}
        </div>

        <div className="relative flex-1">
          <div className="pointer-events-none absolute inset-0 flex h-40 flex-col justify-between" aria-hidden>
            {ticks.map((t) => (
              <div key={t} className="border-t border-border" />
            ))}
          </div>

          <svg
            viewBox={`0 0 ${W} ${H}`}
            preserveAspectRatio="none"
            className="relative h-40 w-full overflow-visible"
            aria-hidden
          >
            {lines.map((points, i) => (
              <polyline
                key={series[i].name}
                data-testid="flow-line"
                points={points.map((p) => `${p.x},${p.y}`).join(" ")}
                fill="none"
                className={SLOTS[i % SLOTS.length].stroke}
                strokeWidth={2}
                strokeLinejoin="round"
                strokeLinecap="round"
                vectorEffect="non-scaling-stroke"
              />
            ))}
          </svg>

          {active !== null ? (
            <>
              <div
                className="pointer-events-none absolute top-0 h-40 border-l border-muted-foreground/40"
                style={{ left: `${xPct(active)}%` }}
                aria-hidden
              />
              {lines.map((points, i) => (
                <span
                  key={series[i].name}
                  className={cn(
                    "pointer-events-none absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 bg-card",
                    SLOTS[i % SLOTS.length].ring,
                  )}
                  style={{ left: `${xPct(active)}%`, top: `${(points[active].y / H) * 10}rem` }}
                  aria-hidden
                />
              ))}
              <div
                role="tooltip"
                className={cn(
                  "absolute top-0 z-10 min-w-40 rounded-md border border-border bg-popover px-2 py-1.5 text-xs shadow-sm",
                  xPct(active) > 60 ? "-translate-x-[calc(100%+8px)]" : "translate-x-2",
                )}
                style={{ left: `${xPct(active)}%` }}
              >
                <div className="mb-1 text-muted-foreground">{labelOf(days[active])}</div>
                {series.map((s, i) => (
                  <div key={s.name} className="flex items-center gap-1.5">
                    <span className={cn("size-2 shrink-0 rounded-full", SLOTS[i % SLOTS.length].swatch)} aria-hidden />
                    <span className="max-w-36 truncate text-foreground">{s.name}</span>
                    <span className="ml-auto pl-2 font-medium tabular-nums text-foreground">{s.values[active]}</span>
                  </div>
                ))}
              </div>
            </>
          ) : null}

          {/* One hit column per day, wider than any mark, for hover and keyboard. */}
          <div className="absolute inset-x-0 top-0 flex h-40">
            {days.map((d, i) => (
              <div
                key={d}
                tabIndex={0}
                aria-label={`${labelOf(d)}: ${series.map((s) => `${s.name} ${s.values[i]}`).join(", ")}`}
                className="h-full flex-1 outline-none focus-visible:bg-accent/40"
                onMouseEnter={() => setActive(i)}
                onMouseLeave={() => setActive(null)}
                onFocus={() => setActive(i)}
                onBlur={() => setActive(null)}
              />
            ))}
          </div>

          <div className="relative mt-1 h-4 text-xs text-muted-foreground" aria-hidden>
            {days.map((d, i) =>
              labelAt.has(i) ? (
                <span
                  key={d}
                  className={cn(
                    "absolute whitespace-nowrap",
                    i === 0 ? "left-0" : i === days.length - 1 ? "right-0" : "-translate-x-1/2",
                  )}
                  style={i === 0 || i === days.length - 1 ? undefined : { left: `${xPct(i)}%` }}
                >
                  {labelOf(d)}
                </span>
              ) : null,
            )}
          </div>
        </div>
      </div>

      {/* The wrapper is what hides: a table never shrinks below its content,
          so `sr-only` on the table itself would widen the page. */}
      <div className="sr-only">
        <table aria-label={title}>
          <thead>
            <tr>
              <th scope="col">Day</th>
              {series.map((s) => (
                <th key={s.name} scope="col">
                  {s.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {days.map((d, i) => (
              <tr key={d}>
                <td>{labelOf(d)}</td>
                {series.map((s) => (
                  <td key={s.name}>{s.values[i]}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </figure>
  );
}
