"use client";

import { useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";

import { cn } from "@/lib/utils";
import { wzAxisLabels, wzChartTicks, wzDayLabel, wzPieSlices, wzSlashDay, wzSpline } from "./chart-scale";

/**
 * Workiz Home's charts, drawn the way its chart.js 2 canvases look
 * (pg_dashboard_wz_home, _bar_hover, _pie_hover): Helvetica 12px #666 ticks
 * with no letter-spacing, a #e5e5e5 axis with 10px tick marks and no grid,
 * chart.js's own "nice" steps, x labels tilted only as far as they must be,
 * and its black tooltip. Every chart also carries its numbers as a table for
 * screen readers.
 */

export interface WzSeries {
  label: string;
  /** A CSS colour — a token's `var(--wz-chart-done)`. */
  color: string;
  /** One value per day, in `days` order. */
  values: number[];
}

/** chart.js's default font. Canvas text has no tracking; Poppins' 0.4px must not leak in. */
const CHART_FONT = "font-[Helvetica_Neue,Helvetica,Arial,sans-serif] text-xs leading-[14.4px] tracking-normal";
const TOP = 7;
const TICK = 10;

/** Helvetica 12px advance widths, near enough to lay labels out without a canvas. */
function textWidth(text: string): number {
  let w = 0;
  for (const c of text) {
    if (/[0-9]/.test(c)) w += 6.67;
    else if (c === " " || c === "/" || c === "." || c === "," || c === "t" || c === "f" || c === "i" || c === "l") w += 3.34;
    else if (/[A-Z]/.test(c)) w += 8;
    else w += 6.4;
  }
  return w;
}

/** The element's width, kept current; `fallback` until it has been measured (and in tests). */
function useWidth(fallback: number): [RefObject<HTMLDivElement | null>, number] {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(fallback);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const read = () => {
      const w = el.getBoundingClientRect().width;
      if (w > 0) setWidth(w);
    };
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width];
}

interface Axes {
  ticks: number[];
  top: number;
  axisX: number;
  plotW: number;
  plotH: number;
  rotation: number;
  every: number;
}

/** Where the y axis stands and how the x labels lie, as chart.js would lay them out. */
function layoutAxes(width: number, height: number, bottom: number, max: number, labels: string[], offset: boolean): Axes {
  const ticks = wzChartTicks(max);
  const top = ticks[ticks.length - 1];
  const yLabel = Math.max(...ticks.map((t) => textWidth(String(t))));
  const xLabel = Math.max(0, ...labels.map(textWidth));
  let axisX = Math.ceil(yLabel) + TICK + 5;
  let plotW = Math.max(1, width - axisX - 3);
  const first = wzAxisLabels(labels.length, plotW, offset, xLabel);
  // A tilted first label hangs left of its tick; chart.js widens the margin to hold it.
  if (!offset && first.rotation > 0) {
    const overhang = Math.ceil(xLabel * Math.cos((first.rotation * Math.PI) / 180)) + 5;
    if (overhang > axisX) {
      axisX = overhang;
      plotW = Math.max(1, width - axisX - 3);
    }
  }
  const { rotation, every } = wzAxisLabels(labels.length, plotW, offset, xLabel);
  return { ticks, top, axisX, plotW, plotH: height - TOP - bottom, rotation, every };
}

/** The y axis, its tick marks and labels, and the x axis line. */
function AxisFrame({ axes, xTicks }: { axes: Axes; xTicks: number[] }) {
  const { ticks, top, axisX, plotW, plotH } = axes;
  const yOf = (t: number) => TOP + plotH * (1 - t / top);
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0">
      {ticks.map((t) => (
        <div key={t}>
          <span
            data-slot="wz-chart-ytick"
            className="absolute -translate-y-1/2 text-right whitespace-nowrap"
            style={{ top: yOf(t), right: `calc(100% - ${axisX - TICK - 3}px)` }}
          >
            {String(t)}
          </span>
          <span className="absolute h-px bg-wz-chart-axis" style={{ top: yOf(t), left: axisX - TICK, width: TICK }} />
        </div>
      ))}
      <span className="absolute w-px bg-wz-chart-axis" style={{ left: axisX, top: TOP, height: plotH + TICK }} />
      <span className="absolute h-px bg-wz-chart-axis" style={{ left: axisX - TICK, top: TOP + plotH, width: plotW + TICK }} />
      {xTicks.map((x) => (
        <span key={x} className="absolute w-px bg-wz-chart-axis" style={{ left: axisX + x, top: TOP + plotH, height: TICK }} />
      ))}
    </div>
  );
}

/** One x label, its end on the tick, tilted about it as chart.js draws a rotated label. */
function XLabel({ x, y, rotation, children }: { x: number; y: number; rotation: number; children: ReactNode }) {
  return (
    <span
      data-slot="wz-chart-xlabel"
      aria-hidden
      className="pointer-events-none absolute whitespace-nowrap"
      style={
        rotation > 0
          ? { left: x, top: y - 7.2, transform: `translateX(-100%) rotate(${-rotation}deg)`, transformOrigin: "100% 50%" }
          : { left: x, top: y, transform: "translateX(-50%)" }
      }
    >
      {children}
    </span>
  );
}

/** chart.js 2's default tooltip: black at 80%, 6px corners and padding, bold title, a colour box a line. */
function ChartTip({
  x,
  y,
  title,
  rows,
}: {
  x: number;
  y: number;
  title: string;
  rows: { label: string; color: string; value: string }[];
}) {
  return (
    <div
      role="tooltip"
      className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full rounded-[6px] bg-black/80 p-1.5 whitespace-nowrap text-white"
      style={{ left: x, top: y - 6 }}
    >
      <div className="mb-0.5 font-bold">{title}</div>
      {rows.map((r) => (
        <div key={r.label} className="flex items-center gap-1">
          <span aria-hidden className="size-2.5 border border-white" style={{ backgroundColor: r.color }} />
          {r.label}: {r.value}
        </div>
      ))}
    </div>
  );
}

function NumbersTable({
  title,
  days,
  labelOf,
  series,
  format,
}: {
  title: string;
  days: string[];
  labelOf: (day: string) => string;
  series: WzSeries[];
  format: (v: number) => string;
}) {
  return (
    // The wrapper hides: a table never shrinks below its content, so sr-only on
    // the table itself would widen the page.
    <div className="sr-only">
      <table aria-label={title}>
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
          {days.map((d, i) => (
            <tr key={d}>
              <td>{labelOf(d)}</td>
              {series.map((s) => (
                <td key={s.label}>{format(s.values[i] ?? 0)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const plain = (v: number) => String(v);

/**
 * A column per series per day (Jobs By Status, Sales): each day's group fills
 * 80% of its slot, the columns touching, round-topped; tick marks between the
 * days (chart.js's offset grid); every day labelled "Sep 24th" unless they
 * crowd. Hover a column for its tooltip; Tab walks the days.
 */
export function WzBarChart({
  title,
  days,
  series,
  format = plain,
  height = 200,
  className,
}: {
  title: string;
  /** `YYYY-MM-DD`, one per slot. */
  days: string[];
  series: WzSeries[];
  /** How a value reads in the tooltip and the table. */
  format?: (v: number) => string;
  height?: number;
  className?: string;
}) {
  const [ref, width] = useWidth(609);
  const [active, setActive] = useState<{ day: number; series: number | null } | null>(null);
  const labels = days.map(wzDayLabel);
  const max = Math.max(0, ...series.flatMap((s) => s.values));
  const axes = layoutAxes(width, height, 43, max, labels, true);
  const { axisX, plotW, plotH, top, rotation, every } = axes;
  const slot = days.length ? plotW / days.length : plotW;
  const bar = series.length ? (slot * 0.8) / series.length : 0;
  const barTop = (v: number) => (Math.max(0, v) / top) * plotH;

  const tip = (() => {
    if (!active) return null;
    const shown = active.series === null ? series.map((_, j) => j) : [active.series];
    const tallest = Math.max(...shown.map((j) => barTop(series[j].values[active.day] ?? 0)));
    const x =
      axisX +
      active.day * slot +
      slot * 0.1 +
      (active.series === null ? slot * 0.4 : bar * (active.series + 0.5));
    return (
      <ChartTip
        x={x}
        y={TOP + plotH - tallest}
        title={labels[active.day]}
        rows={shown.map((j) => ({
          label: series[j].label,
          color: series[j].color,
          value: format(series[j].values[active.day] ?? 0),
        }))}
      />
    );
  })();

  return (
    <figure className={cn("relative", CHART_FONT, "text-wz-text", className)}>
      <div ref={ref} className="relative w-full" style={{ height }}>
        <AxisFrame axes={axes} xTicks={days.map((_, i) => (i + 1) * slot)} />
        {days.map((day, i) => (
          <div
            key={day}
            role="button"
            tabIndex={0}
            aria-label={`${labels[i]}: ${series.map((s) => `${s.label} ${format(s.values[i] ?? 0)}`).join(", ")}`}
            className="absolute outline-none focus-visible:bg-black/5"
            style={{ left: axisX + i * slot, top: TOP, width: slot, height: plotH }}
            onFocus={() => setActive({ day: i, series: null })}
            onBlur={() => setActive(null)}
          >
            {series.map((s, j) => (
              <span
                key={s.label}
                data-slot="wz-chart-bar"
                data-series={s.label}
                className="absolute bottom-0 rounded-t-[5px]"
                style={{
                  left: slot * 0.1 + j * bar,
                  width: bar,
                  height: `${barTop(s.values[i] ?? 0)}px`,
                  backgroundColor: s.color,
                }}
                onMouseEnter={() => setActive({ day: i, series: j })}
                onMouseLeave={() => setActive(null)}
              />
            ))}
          </div>
        ))}
        {labels.map((label, i) =>
          i % every === 0 ? (
            <XLabel key={days[i]} x={axisX + (i + 0.5) * slot} y={TOP + plotH + TICK + 7} rotation={rotation}>
              {label}
            </XLabel>
          ) : null,
        )}
        {tip}
      </div>
      <NumbersTable title={title} days={days} labelOf={wzDayLabel} series={series} format={format} />
    </figure>
  );
}

/**
 * A curved line per series over the days (Top Call Flows): chart.js's
 * tension-.4 spline, a 3px ring on every day, labels "09/24/26" under the
 * ticks. Hover or focus a day for every series' count.
 */
export function WzLineChart({
  title,
  days,
  series,
  height = 180,
  className,
}: {
  title: string;
  days: string[];
  series: WzSeries[];
  height?: number;
  className?: string;
}) {
  const [ref, width] = useWidth(609);
  const [active, setActive] = useState<number | null>(null);
  const labels = days.map(wzSlashDay);
  const max = Math.max(0, ...series.flatMap((s) => s.values));
  const axes = layoutAxes(width, height, 41, max, labels, false);
  const { axisX, plotW, plotH, top, rotation, every } = axes;
  const step = days.length > 1 ? plotW / (days.length - 1) : 0;
  const xOf = (i: number) => (days.length > 1 ? i * step : plotW / 2);
  const yOf = (v: number) => plotH - (Math.max(0, v) / top) * plotH;

  return (
    <figure className={cn("relative", CHART_FONT, "text-wz-text", className)}>
      <div ref={ref} className="relative w-full" style={{ height }}>
        <AxisFrame axes={axes} xTicks={days.map((_, i) => xOf(i))} />
        <svg
          aria-hidden
          className="pointer-events-none absolute overflow-visible"
          style={{ left: axisX, top: TOP }}
          width={plotW}
          height={plotH}
        >
          {series.map((s) => {
            const points = s.values.map((v, i) => ({ x: xOf(i), y: yOf(v) }));
            return (
              <g key={s.label}>
                <path data-slot="wz-chart-line" d={wzSpline(points, plotH)} fill="none" stroke={s.color} strokeWidth={1.5} />
                {points.map((p, i) => (
                  <circle
                    key={i}
                    data-slot="wz-chart-point"
                    cx={p.x}
                    cy={p.y}
                    r={active === i ? 4 : 3}
                    fill="#fff"
                    stroke={s.color}
                    strokeWidth={1}
                  />
                ))}
              </g>
            );
          })}
        </svg>
        {days.map((day, i) => (
          <div
            key={day}
            role="button"
            tabIndex={0}
            aria-label={`${labels[i]}: ${series.map((s) => `${s.label} ${s.values[i] ?? 0}`).join(", ")}`}
            className="absolute outline-none focus-visible:bg-black/5"
            style={{
              left: axisX + xOf(i) - (step || plotW) / 2,
              top: TOP,
              width: step || plotW,
              height: plotH,
            }}
            onMouseEnter={() => setActive(i)}
            onMouseLeave={() => setActive(null)}
            onFocus={() => setActive(i)}
            onBlur={() => setActive(null)}
          />
        ))}
        {labels.map((label, i) =>
          i % every === 0 ? (
            <XLabel key={days[i]} x={axisX + xOf(i)} y={TOP + plotH + TICK + 7} rotation={rotation}>
              {label}
            </XLabel>
          ) : null,
        )}
        {active !== null ? (
          <ChartTip
            x={axisX + xOf(active)}
            y={TOP + Math.min(...series.map((s) => yOf(s.values[active] ?? 0)))}
            title={labels[active]}
            rows={series.map((s) => ({ label: s.label, color: s.color, value: String(s.values[active] ?? 0) }))}
          />
        ) : null}
      </div>
      <NumbersTable title={title} days={days} labelOf={wzSlashDay} series={series} format={plain} />
    </figure>
  );
}

export interface WzPieSliceData {
  key: string;
  name: string;
  count: number;
  /** 0–100, two decimals. */
  percent: number;
}

/** The pie's slice colours in order (Workiz picks from this palette at random on each load). */
export const WZ_PIE_COLORS = ["var(--wz-pie-yellow)", "var(--wz-series1)", "var(--wz-series2)", "var(--wz-series3)"];

/**
 * Top Sources / Top Job Types / Service Areas: a 71px pie (white 2px seams,
 * clockwise from twelve) centred in a 75px band 20px below the range, then
 * Workiz's legend two by two — the name 12px/18px #a0a0a0 cut with an
 * ellipsis over the percent 20px/33px #6d6d6d, the left column ruled on its
 * left, the right column on its right and set flush right, 2px in the
 * slice's colour.
 */
export function WzPie({
  title,
  slices,
  valueText = (n: number) => String(n),
  className,
}: {
  title: string;
  slices: WzPieSliceData[];
  /** How a slice's count reads in its tooltip. */
  valueText?: (count: number) => string;
  className?: string;
}) {
  const [active, setActive] = useState<number | null>(null);
  if (!slices.length) {
    return <p className="pt-[60px] text-center text-sm leading-[18px] text-wz-dash-label">No data to display</p>;
  }
  const wedges = wzPieSlices(slices.map((s) => s.count));
  const colorOf = (i: number) => WZ_PIE_COLORS[i % WZ_PIE_COLORS.length];
  const shown = active === null ? null : slices[active];

  return (
    <figure className={cn("flex flex-col", className)}>
      <div className="relative flex h-[115px] items-center justify-center py-5">
        <svg viewBox="-1 -1 102 102" className="size-[71px]" aria-hidden>
          {wedges.map((w, i) => (
            <path
              key={slices[i].key}
              data-slot="wz-pie-slice"
              d={w.path}
              fill={colorOf(i)}
              stroke="#fff"
              strokeWidth={2}
              vectorEffect="non-scaling-stroke"
              strokeLinejoin="round"
              onMouseEnter={() => setActive(i)}
              onMouseLeave={() => setActive(null)}
            />
          ))}
        </svg>
        {shown ? (
          <div
            role="tooltip"
            className={cn(
              "pointer-events-none absolute top-1/2 left-1/2 z-10 flex -translate-x-1/2 -translate-y-1/2 items-center gap-1 rounded-[6px] bg-black/80 p-1.5 whitespace-nowrap text-white",
              CHART_FONT,
            )}
          >
            <span aria-hidden className="size-2.5 border border-white" style={{ backgroundColor: colorOf(active!) }} />
            {shown.name}: {valueText(shown.count)}
          </div>
        ) : null}
      </div>
      <ul aria-label="Legend" className="-mr-[7px] ml-[7px] grid grid-cols-2 gap-x-5 gap-y-[15px]">
        {slices.map((s, i) => {
          const right = i % 2 === 1;
          return (
            <li
              key={s.key}
              className={cn("flex min-w-0 flex-col px-2.5", right ? "items-end border-r-2 text-right" : "border-l-2")}
              style={{ borderColor: colorOf(i) }}
            >
              <span className="w-full truncate text-xs leading-[18px] text-wz-dash-label" title={s.name}>
                {s.name}
              </span>
              <span className="text-xl leading-[33px] text-wz-dash-value tabular-nums">{s.percent.toFixed(2)}%</span>
            </li>
          );
        })}
      </ul>
      <div className="sr-only">
        <table aria-label={title}>
          <thead>
            <tr>
              <th scope="col">Name</th>
              <th scope="col">Count</th>
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
