"use client";

import { useLayoutEffect, useRef, useState, type MouseEvent } from "react";
import { cn } from "@/lib/utils";
import { wzSpline } from "./chart-scale";
import { tickLabel } from "./charts";

/*
 * Workiz's Call Tracking graph (rep_calltracking_wz_01_default, _03_chart_tooltip,
 * _04_graph_*, _11_preset_today): a Chart.js 2 `line` chart with every line
 * filled to zero, redrawn in SVG with Chart.js's own geometry, read off the
 * live `Chart.instances` (scales, chart area, element models):
 *   - the canvas is as wide as its box and a fifth as tall (1360×272);
 *   - y: a linear scale from the data's floor, nice steps (`chartLinearTicks`),
 *     12px 'Helvetica Neue' #666 labels 10px off the axis, rgba(0,0,0,.1)
 *     grid with 10px tick marks, the zero line .25, the axis line itself;
 *   - x: a category axis without grid lines; the labels tilt one by one up
 *     to 50° when they crowd (21° for 24 hours) and are thinned past that;
 *   - each line: tension .4, 1px, filled to zero at 20% of its colour; every
 *     point a 3px ring filled 20%. The fills lie under every line, and the
 *     first line on top, as Chart.js draws them;
 *   - the pointer over a point (3px + 1px hit radius) raises every point of
 *     that bucket to 4px at 40% and opens Chart.js's black tooltip: the bucket
 *     in bold over "■ name: n";
 *   - under the canvas Workiz's own HTML legend (`ul._flowLegend`): 25.2px in,
 *     10px above and below, 35px tall, one item per line at most 150px wide
 *     (a 20px box of the 20% colour 10px in, the name under it, cut with an
 *     ellipsis) — a hundred flows squeeze it into thin stripes, as in Workiz.
 */

const FONT_FAMILY = "'Helvetica Neue', Helvetica, Arial, sans-serif";
const FONT_SIZE = 12;
/** Chart.js 2's line height for its 12px ticks (1.2). */
const LINE = 14.4;
const TICK = 10;
const TEXT = "#666666";
const GRID = "rgba(0,0,0,0.1)";
const ZERO = "rgba(0,0,0,0.25)";
const RADIUS = 3;
const HOVER_RADIUS = 4;
const HIT_RADIUS = 1;
/** The y axis's box beyond its widest label and the 10px tick marks (measured: "45" → 29.9px). */
const Y_AXIS_EXTRA = 16.56;
/** The canvas's width until it has been measured (and in tests). */
export const WZ_AREA_FALLBACK_WIDTH = 1000;

/* --------------------------------------------------------------- measure */

let measureCtx: CanvasRenderingContext2D | null | undefined;
/** Helvetica 12px advance widths, for a page (or a test) without a canvas. */
const APPROX: Record<string, number> = { " ": 3.34, ":": 3.34, "/": 3.34, ".": 3.34, A: 8, M: 10, P: 8 };
/** A label's width in Chart.js's font — the canvas's own measure where there is one. */
function textWidth(text: string): number {
  if (measureCtx === undefined) {
    measureCtx = null;
    const jsdom = typeof navigator !== "undefined" && /jsdom/i.test(navigator.userAgent);
    if (typeof document !== "undefined" && !jsdom) {
      measureCtx = document.createElement("canvas").getContext("2d");
      if (measureCtx) measureCtx.font = `${FONT_SIZE}px ${FONT_FAMILY}`;
    }
  }
  if (measureCtx) return measureCtx.measureText(text).width;
  let w = 0;
  for (const c of text) w += APPROX[c] ?? (/[0-9]/.test(c) ? 6.67 : /[A-Z]/.test(c) ? 8 : 6);
  return w;
}

function useWidth<T extends HTMLElement>(fallback: number) {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(fallback);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const read = () => setWidth(el.clientWidth || fallback);
    read();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, [fallback]);
  return [ref, width] as const;
}

/* ----------------------------------------------------------------- scales */

/** Chart.js's `helpers.niceNum`, the branch its tick generator uses (no rounding). */
function niceNum(range: number): number {
  const exponent = Math.floor(Math.log10(range));
  const fraction = range / 10 ** exponent;
  const nice = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10;
  return nice * 10 ** exponent;
}

function decimalPlaces(n: number): number {
  if (Math.round(n) === n) return 0;
  let e = 1;
  let p = 0;
  while (Math.round(n * e) / e !== n && p < 20) {
    e *= 10;
    p += 1;
  }
  return p;
}

/**
 * The ticks of Chart.js 2's linear scale over [min, max] (`generateTicks`,
 * `beginAtZero` off): at most `maxTicks`, a nice spacing, both ends rounded
 * out to it. A flat line is opened out by one each way, as Chart.js does.
 */
export function chartLinearTicks(min: number, max: number, maxTicks = 11): number[] {
  let lo = Number.isFinite(min) ? min : 0;
  let hi = Number.isFinite(max) ? max : 1;
  if (lo === hi) {
    hi += 1;
    lo -= 1;
  }
  const spaces = Math.max(1, maxTicks - 1);
  let spacing = niceNum((hi - lo) / spaces);
  const count = Math.ceil(hi / spacing) - Math.floor(lo / spacing);
  if (count > spaces) spacing = niceNum((count * spacing) / spaces);
  const factor = 10 ** decimalPlaces(spacing);
  const niceMin = Math.round(Math.floor(lo / spacing) * spacing * factor) / factor;
  const niceMax = Math.round(Math.ceil(hi / spacing) * spacing * factor) / factor;
  const raw = (niceMax - niceMin) / spacing;
  const n = Math.abs(raw - Math.round(raw)) <= spacing / 1000 ? Math.round(raw) : Math.ceil(raw);
  const out = [niceMin];
  for (let j = 1; j < n; j++) out.push(Math.round((niceMin + j * spacing) * factor) / factor);
  out.push(niceMax);
  return out;
}

export interface WzAreaLayout {
  ticks: number[];
  yLabels: string[];
  /** The x labels' tilt, degrees. */
  rotation: number;
  /** Every n-th x label is drawn (Chart.js's auto-skip). */
  every: number;
  top: number;
  bottom: number;
  left: number;
  right: number;
}

/**
 * Where Chart.js 2 lays the plot out on a `width`×`height` canvas: the x
 * labels' tilt (`calculateLabelRotation`), the room they take under the plot
 * and beside it (`fit`), the y axis's width, and how many x labels fit.
 */
export function areaLayout({
  width,
  height,
  labels,
  min,
  max,
}: {
  width: number;
  height: number;
  labels: readonly string[];
  min: number;
  max: number;
}): WzAreaLayout {
  const n = labels.length;
  const widths = labels.map(textWidth);
  const widest = n ? Math.max(...widths) : 0;
  let rotation = 0;
  if (n > 1) {
    const tickWidth = (width - widest) / (n - 1);
    if (widest + 6 > tickWidth) {
      rotation = Math.min(50, (Math.asin(Math.min((LINE + 6) / tickWidth, 1)) * 180) / Math.PI);
    }
  }
  const rad = (rotation * Math.PI) / 180;
  const sin = Math.sin(rad);
  const cos = Math.cos(rad);
  const half = LINE / 2;
  const xAxisHeight = rotation ? TICK + sin * widest + cos * (LINE - half) : TICK + LINE + LINE * 0.4;
  const padLeft = rotation ? cos * (widths[0] ?? 0) + sin * half + 3 : (widths[0] ?? 0) / 2 + 3;
  const padRight = rotation ? sin * (LINE - half) + 3 : (widths[n - 1] ?? 0) / 2 + 3;
  const top = half;
  const bottom = height - xAxisHeight;
  const ticks = chartLinearTicks(min, max, Math.min(11, Math.max(2, Math.ceil((bottom - top) / LINE))));
  const yLabels = ticks.map((t) => tickLabel(t, ticks));
  const left = Math.max(Math.max(...yLabels.map(textWidth)) + Y_AXIS_EXTRA, padLeft);
  const right = width - padRight;
  // Auto-skip: the room one tilted label takes along the axis.
  const tickSize = LINE * cos > widest * sin ? widest / cos : LINE / sin;
  const limit = (right - left) / tickSize + 1;
  const every = n > limit ? Math.ceil(n / limit) : 1;
  return { ticks, yLabels, rotation, every, top, bottom, left, right };
}

export interface WzAreaPoint {
  x: number;
  y: number;
}

/** Each series' points on the canvas: buckets evenly from the plot's left edge to its right. */
export function areaPoints(layout: WzAreaLayout, series: readonly { values: readonly number[] }[], count: number): WzAreaPoint[][] {
  const lo = layout.ticks[0];
  const hi = layout.ticks[layout.ticks.length - 1];
  const step = count > 1 ? (layout.right - layout.left) / (count - 1) : 0;
  const yOf = (v: number) => layout.bottom - ((v - lo) / (hi - lo || 1)) * (layout.bottom - layout.top);
  return series.map((s) => Array.from({ length: count }, (_, i) => ({ x: layout.left + i * step, y: yOf(s.values[i] ?? 0) })));
}

/**
 * The point under the pointer, as Chart.js's `nearest` mode with `intersect`
 * finds it: within the point's radius plus its hit radius, the closest one,
 * the first series on a tie. Null when the pointer touches none.
 */
export function nearestPoint(
  points: readonly (readonly WzAreaPoint[])[],
  x: number,
  y: number,
  reach = RADIUS + HIT_RADIUS,
): { series: number; index: number } | null {
  let best: { series: number; index: number } | null = null;
  let bestD = Infinity;
  points.forEach((line, s) =>
    line.forEach((p, i) => {
      const d = Math.hypot(p.x - x, p.y - y);
      if (d <= reach && d < bestD) {
        bestD = d;
        best = { series: s, index: i };
      }
    }),
  );
  return best;
}

/* ---------------------------------------------------------------- tooltip */

const CARET = 5;
const CARET_PAD = 2;
const CORNER = 6;

/** Chart.js 2's `determineAlignment` + `getBackgroundPoint`: where the box goes beside its point. */
function tooltipBox(
  p: WzAreaPoint,
  size: { w: number; h: number },
  chart: { w: number; h: number; left: number; right: number; top: number; bottom: number },
) {
  let yAlign: "top" | "center" | "bottom" = p.y < size.h ? "top" : p.y > chart.h - size.h ? "bottom" : "center";
  const midX = (chart.left + chart.right) / 2;
  const midY = (chart.top + chart.bottom) / 2;
  const lf = (x: number) => (yAlign === "center" ? x <= midX : x <= size.w / 2);
  const rf = (x: number) => (yAlign === "center" ? x > midX : x >= chart.w - size.w / 2);
  let xAlign: "left" | "center" | "right" = "center";
  if (lf(p.x)) {
    xAlign = "left";
    if (p.x + size.w + CARET + CARET_PAD > chart.w) {
      xAlign = "center";
      yAlign = p.y <= midY ? "top" : "bottom";
    }
  } else if (rf(p.x)) {
    xAlign = "right";
    if (p.x - size.w - CARET - CARET_PAD < 0) {
      xAlign = "center";
      yAlign = p.y <= midY ? "top" : "bottom";
    }
  }
  let x = p.x;
  let y = p.y;
  if (xAlign === "right") x -= size.w;
  else if (xAlign === "center") x = Math.min(Math.max(0, x - size.w / 2), chart.w - size.w);
  if (yAlign === "top") y += CARET + CARET_PAD;
  else if (yAlign === "bottom") y -= size.h + CARET + CARET_PAD;
  else y -= size.h / 2;
  if (yAlign === "center") {
    if (xAlign === "left") x += CARET + CARET_PAD;
    else if (xAlign === "right") x -= CARET + CARET_PAD;
  } else if (xAlign === "left") x -= CORNER + CARET_PAD;
  else if (xAlign === "right") x += CORNER + CARET_PAD;
  return { x, y, xAlign, yAlign };
}

/** Chart.js's tooltip: 80% black, 6px corners, 6px in; the bold title 6px over one line with its colour box. */
function AreaTooltip({
  point,
  title,
  text,
  color,
  chart,
}: {
  point: WzAreaPoint;
  title: string;
  text: string;
  color: string;
  chart: { w: number; h: number; left: number; right: number; top: number; bottom: number };
}) {
  const size = {
    w: Math.max(textWidth(title) * 1.08, FONT_SIZE + 2 + textWidth(text)) + 12,
    h: 6 + FONT_SIZE + 6 + FONT_SIZE + 6,
  };
  const box = tooltipBox(point, size, chart);
  // The caret: on the edge facing the point.
  const caret =
    box.yAlign === "center"
      ? box.xAlign === "left"
        ? { left: -CARET, top: point.y - box.y - CARET, border: "border-y-[5px] border-r-[5px] border-y-transparent border-r-black/80" }
        : { left: size.w, top: point.y - box.y - CARET, border: "border-y-[5px] border-l-[5px] border-y-transparent border-l-black/80" }
      : box.yAlign === "top"
        ? { left: point.x - box.x - CARET, top: -CARET, border: "border-x-[5px] border-b-[5px] border-x-transparent border-b-black/80" }
        : { left: point.x - box.x - CARET, top: size.h, border: "border-x-[5px] border-t-[5px] border-x-transparent border-t-black/80" };
  return (
    <div
      role="tooltip"
      className="pointer-events-none absolute z-10 rounded-[6px] bg-black/80 p-1.5 text-xs leading-3 whitespace-nowrap text-white"
      style={{ left: box.x, top: box.y, fontFamily: FONT_FAMILY, letterSpacing: 0 }}
    >
      <span aria-hidden className={cn("absolute size-0", caret.border)} style={{ left: caret.left, top: caret.top }} />
      <div className="mb-1.5 font-bold">{title}</div>
      <div className="flex items-center gap-0.5">
        {/* A white square edged in the line's colour, its 20% fill inside. */}
        <span className="relative inline-block size-3 shrink-0 border bg-white" style={{ borderColor: color }}>
          <span className="absolute inset-0" style={{ background: tint(color, 20) }} />
        </span>
        {text}
      </div>
    </div>
  );
}

/** A colour at `percent` opacity — CSS colours and tokens alike. */
const tint = (color: string, percent: number) => `color-mix(in srgb, ${color} ${percent}%, transparent)`;

/* ------------------------------------------------------------------ chart */

export interface WzAreaSeries {
  label: string;
  values: readonly number[];
  /** Any CSS colour: a token's `var(--wz-series1)`, `rgb(…)`. */
  color: string;
}

/** A row of circles as one path: `points` far cheaper than a node each. */
function ringsPath(points: readonly WzAreaPoint[], r: number): string {
  return points
    .map((p) => `M${(p.x - r).toFixed(2)} ${p.y.toFixed(2)}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0`)
    .join("");
}

/**
 * Workiz's Call Tracking graph: one filled line per series over the labels,
 * Chart.js 2's look and geometry, its tooltip, Workiz's HTML legend below.
 * The numbers are also a table (each bucket's total) for screen readers.
 */
export function WzAreaChart({
  labels,
  series,
  aspectRatio = 5,
  legend = true,
  className,
  "aria-label": ariaLabel,
}: {
  labels: readonly string[];
  series: readonly WzAreaSeries[];
  /** Chart.js's canvas: as wide as its box, this many times less tall. */
  aspectRatio?: number;
  legend?: boolean;
  className?: string;
  "aria-label": string;
}) {
  const [ref, width] = useWidth<HTMLDivElement>(WZ_AREA_FALLBACK_WIDTH);
  const [active, setActive] = useState<{ series: number; index: number } | null>(null);
  const height = width / aspectRatio;
  const all = series.flatMap((s) => s.values.slice(0, labels.length));
  const layout = areaLayout({
    width,
    height,
    labels,
    min: all.length ? Math.min(...all) : 0,
    max: all.length ? Math.max(...all) : 1,
  });
  const points = areaPoints(layout, series, labels.length);
  const lo = layout.ticks[0];
  const hi = layout.ticks[layout.ticks.length - 1];
  const yOfTick = (t: number) => layout.bottom - ((t - lo) / (hi - lo || 1)) * (layout.bottom - layout.top);
  const zeroY = Math.min(layout.bottom, Math.max(layout.top, yOfTick(Math.min(Math.max(0, lo), hi))));
  const plotH = layout.bottom - layout.top;
  const crisp = (v: number) => Math.round(v) + 0.5;

  const onMove = (e: MouseEvent<SVGRectElement>) => {
    const box = (e.currentTarget.ownerSVGElement ?? e.currentTarget).getBoundingClientRect();
    setActive(nearestPoint(points, e.clientX - box.left, e.clientY - box.top));
  };

  // Chart.js draws the fills first, the last dataset lowest; then the lines
  // and points, again the last first — the first series ends up on top.
  const order = series.map((_, i) => i).reverse();
  const spline = (line: readonly WzAreaPoint[]) =>
    wzSpline(
      line.map((p) => ({ x: p.x, y: p.y - layout.top })),
      plotH,
    );

  return (
    <figure className={cn("relative m-0 w-full", className)}>
      <div ref={ref} className="relative w-full" style={{ height }}>
        <svg
          role="img"
          aria-label={ariaLabel}
          width={width}
          height={height}
          className="block"
          style={{ fontFamily: FONT_FAMILY, letterSpacing: 0 }}
        >
          {/* y grid, its 10px tick marks and the labels; the zero line darker */}
          {layout.ticks.map((t, k) => {
            const y = crisp(yOfTick(t));
            return (
              <g key={`${t}-${k}`}>
                <line x1={layout.left - TICK} x2={layout.right} y1={y} y2={y} stroke={t === 0 ? ZERO : GRID} />
                <text x={layout.left - TICK} y={y} textAnchor="end" dominantBaseline="central" fontSize={FONT_SIZE} fill={TEXT}>
                  {layout.yLabels[k]}
                </text>
              </g>
            );
          })}
          {/* the y axis's own edge */}
          <line x1={crisp(layout.left)} x2={crisp(layout.left)} y1={layout.top} y2={layout.bottom} stroke={GRID} />
          <g>
            {order.map((s) => {
              const line = points[s];
              if (!line.length) return null;
              const d = `${spline(line)} L${line[line.length - 1].x} ${zeroY - layout.top} L${line[0].x} ${zeroY - layout.top}Z`;
              return (
                <path
                  key={s}
                  data-slot="wz-area-fill"
                  transform={`translate(0 ${layout.top})`}
                  d={d}
                  fill={series[s].color}
                  fillOpacity={0.2}
                  stroke="none"
                />
              );
            })}
          </g>
          <g>
            {order.map((s) => (
              <g key={s}>
                <path
                  data-slot="wz-area-line"
                  transform={`translate(0 ${layout.top})`}
                  d={spline(points[s])}
                  fill="none"
                  stroke={series[s].color}
                  strokeWidth={1}
                />
                <path d={ringsPath(points[s], RADIUS)} fill={series[s].color} fillOpacity={0.2} stroke={series[s].color} strokeWidth={1} />
              </g>
            ))}
          </g>
          {active ? (
            <g>
              {order.map((s) => {
                const p = points[s][active.index];
                return p ? (
                  <circle key={s} cx={p.x} cy={p.y} r={HOVER_RADIUS} fill={tint(series[s].color, 40)} stroke={series[s].color} strokeWidth={1} />
                ) : null;
              })}
            </g>
          ) : null}
          {/* x labels: level and centred, or tilted with their end on the tick */}
          {labels.map((label, i) => {
            if (layout.every > 1 && i % layout.every > 0) return null;
            const x = points[0]?.[i]?.x ?? layout.left + (labels.length > 1 ? (i * (layout.right - layout.left)) / (labels.length - 1) : 0);
            const y = layout.bottom + TICK;
            return layout.rotation ? (
              <text
                key={`${label}-${i}`}
                x={x}
                y={y + 2}
                transform={`rotate(${-layout.rotation} ${x} ${y + 2})`}
                textAnchor="end"
                dominantBaseline="central"
                fontSize={FONT_SIZE}
                fill={TEXT}
                style={{ whiteSpace: "pre" }}
              >
                {label}
              </text>
            ) : (
              <text
                key={`${label}-${i}`}
                x={x}
                y={y + 1}
                textAnchor="middle"
                dominantBaseline="hanging"
                fontSize={FONT_SIZE}
                fill={TEXT}
                style={{ whiteSpace: "pre" }}
              >
                {label}
              </text>
            );
          })}
          <rect
            data-slot="wz-area-hit"
            x={0}
            y={0}
            width={width}
            height={height}
            fill="transparent"
            onMouseMove={onMove}
            onMouseLeave={() => setActive(null)}
          />
        </svg>
        {active && points[active.series]?.[active.index] ? (
          <AreaTooltip
            point={points[active.series][active.index]}
            title={labels[active.index]}
            text={`${series[active.series].label}: ${series[active.series].values[active.index] ?? 0}`}
            color={series[active.series].color}
            chart={{ w: width, h: height, left: layout.left, right: layout.right, top: layout.top, bottom: layout.bottom }}
          />
        ) : null}
      </div>
      {legend ? (
        <ul
          aria-label={`${ariaLabel} legend`}
          className="ml-[25.2px] box-content flex h-[35px] list-none overflow-auto py-2.5 text-sm leading-4 text-wz-strong"
        >
          {series.map((s) => (
            <li key={s.label} className="block h-[35px] max-w-[150px] min-w-0 shrink overflow-hidden text-ellipsis whitespace-nowrap">
              <div aria-hidden className="mx-2.5 size-5" style={{ backgroundColor: tint(s.color, 20) }} />
              {s.label}
            </li>
          ))}
        </ul>
      ) : null}
      <table aria-label={ariaLabel} className="sr-only">
        <thead>
          <tr>
            <th scope="col" />
            <th scope="col">Calls</th>
          </tr>
        </thead>
        <tbody>
          {labels.map((label, i) => (
            <tr key={`${label}-${i}`}>
              <th scope="row">{label}</th>
              <td>{series.reduce((sum, s) => sum + (s.values[i] ?? 0), 0)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
