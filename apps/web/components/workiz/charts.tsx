"use client";

import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/*
 * Workiz's legacy charts, redrawn in SVG: the Chart.js 2 bar charts and pies
 * of Job Statistics (rep_jobstats_wz_02_overview_day, _04_chart_tooltip,
 * _13_dispatcher_top, _15_empty_overview). The geometry is Chart.js's own,
 * read off Workiz's live `Chart.instances` (chart areas, scales, legend hit
 * boxes, arcs): 12px 'Helvetica Neue' #666 text, rgba(0,0,0,.1) grid,
 * rgba(0,0,0,.25) zero line, 10px tick marks, 40×12 legend boxes 10px apart
 * on a 32px band, bars at 80% × 90% of their category.
 */

const FONT_FAMILY = "'Helvetica Neue', Helvetica, Arial, sans-serif";
const FONT = `12px ${FONT_FAMILY}`;
const TEXT = "#666666";
const GRID = "rgba(0,0,0,0.1)";
const ZERO = "rgba(0,0,0,0.25)";
const TICK_MARK = 10;
const LEGEND_PAD = 10;
const FONT_SIZE = 12;

/* --------------------------------------------------------------- measure */

let measureCtx: CanvasRenderingContext2D | null | undefined;
/** A label's width in Chart.js's font — the canvas's own measure, or a close guess where there is none (tests). */
function textWidth(text: string): number {
  if (measureCtx === undefined) {
    measureCtx = null;
    const jsdom =
      typeof navigator !== "undefined" && /jsdom/i.test(navigator.userAgent);
    if (typeof document !== "undefined" && !jsdom) {
      measureCtx = document.createElement("canvas").getContext("2d");
      if (measureCtx) measureCtx.font = FONT;
    }
  }
  return measureCtx ? measureCtx.measureText(text).width : text.length * 6.67;
}

/** The width an element is given — one ResizeObserver, a fallback where there is none. */
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

/** Chart.js's niceNum, the not-rounding branch its tick generator uses. */
function niceNum(range: number): number {
  const exponent = Math.floor(Math.log10(range));
  const fraction = range / 10 ** exponent;
  const nice = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10;
  return nice * 10 ** exponent;
}

/**
 * The y ticks of a `beginAtZero` linear scale with at most 11 ticks, as
 * Chart.js generates them: a nice step, from 0 to the first step at or past
 * the top. Nothing to draw: 0 to 1 by tenths.
 */
export function chartTicks(max: number, maxTicks = 11): number[] {
  const top = max > 0 ? max : 1;
  let step = niceNum(top / (maxTicks - 1));
  if (Math.ceil(top / step) > maxTicks - 1)
    step = niceNum((Math.ceil(top / step) * step) / (maxTicks - 1));
  const n = Math.round(Math.ceil(top / step - 1e-9));
  const decimals = Math.max(0, -Math.floor(Math.log10(step)));
  return Array.from({ length: n + 1 }, (_, i) =>
    Number((i * step).toFixed(decimals)),
  );
}

/** Chart.js's linear tick label: no grouping, as many decimals as the step has; zero is "0". */
export function tickLabel(value: number, ticks: readonly number[]): string {
  if (value === 0) return "0";
  const delta =
    ticks.length > 3 ? ticks[2] - ticks[1] : (ticks[1] ?? 1) - (ticks[0] ?? 0);
  const decimals = Math.max(
    0,
    Math.min(20, -Math.floor(Math.log10(Math.abs(delta)))),
  );
  return value.toFixed(decimals);
}

/**
 * The category axis's labels: Chart.js tips them a degree at a time (to 50°)
 * while the widest no longer fits its category less 6px, then shows every
 * n-th when even tipped they would overlap.
 */
export function xLabelLayout({
  count,
  plotWidth,
  labelWidth,
}: {
  count: number;
  plotWidth: number;
  labelWidth: number;
}) {
  if (count < 1) return { rotation: 0, skip: 1 };
  const tickWidth = plotWidth / count - 6;
  let rotation = 0;
  let width = labelWidth;
  while (count > 1 && width > tickWidth && rotation < 50) {
    width = Math.cos((rotation * Math.PI) / 180) * labelWidth;
    rotation += 1;
  }
  const rotated = Math.cos((rotation * Math.PI) / 180) * labelWidth;
  const skip =
    rotated * count > plotWidth
      ? 1 + Math.floor((rotated * count) / plotWidth)
      : 1;
  return { rotation, skip };
}

/* ----------------------------------------------------------------- legend */

/** Chart.js's legend lines: items packed while they fit, each line's width with its 10px gaps. */
export function legendLines(
  itemWidths: readonly number[],
  maxWidth: number,
): { items: number[]; width: number }[] {
  const lines: { items: number[]; width: number }[] = [];
  itemWidths.forEach((w, i) => {
    const last = lines.at(-1);
    if (!last || last.width + w + 2 * LEGEND_PAD > maxWidth)
      lines.push({ items: [i], width: w + LEGEND_PAD });
    else {
      last.items.push(i);
      last.width += w + LEGEND_PAD;
    }
  });
  return lines;
}

/**
 * A pie with its legend below (Chart.js: lines of 12px + 10px, 10px above
 * them): the pie gets what is left, less its 2px border. A legend taller than
 * the box leaves no pie and loses its first lines off the top — as Workiz's
 * Sources pie does with its 130 rows.
 */
export function pieLayout({
  width,
  height,
  lines,
}: {
  width: number;
  height: number;
  lines: number;
}) {
  const legendHeight = LEGEND_PAD + lines * (FONT_SIZE + LEGEND_PAD);
  const areaHeight = Math.max(0, height - legendHeight);
  const radius =
    areaHeight > 0 ? Math.max(0, Math.min(width, areaHeight) / 2 - 2) : 0;
  return { areaHeight, radius, legendTop: height - legendHeight };
}

/* ---------------------------------------------------------------- tooltip */

/** Chart.js's tooltip: 80% black, radius 6, 6px in, a bold 12px title over 12px lines with a colour box. */
function Tooltip({
  x,
  y,
  title,
  lines,
  flip,
}: {
  x: number;
  y: number;
  title?: string;
  lines: { color: string; text: string }[];
  flip: boolean;
}) {
  return (
    <div
      role="tooltip"
      className="pointer-events-none absolute z-10 rounded-[6px] bg-black/80 p-1.5 text-xs leading-[14px] whitespace-nowrap text-white"
      style={{
        left: x,
        top: y,
        transform: `translate(${flip ? "calc(-100% - 7px)" : "7px"}, -50%)`,
        fontFamily: FONT_FAMILY,
        letterSpacing: 0,
      }}
    >
      {title ? <div className="mb-1.5 font-bold">{title}</div> : null}
      {lines.map((l) => (
        <div key={l.text} className="flex items-center gap-1">
          <span
            className="inline-block size-3 border border-white"
            style={{ background: l.color }}
          />
          {l.text}
        </div>
      ))}
    </div>
  );
}

/** A screen reader's view of a chart: its numbers. */
function DataTable({
  label,
  head,
  rows,
}: {
  label: string;
  head: string[];
  rows: (string | number)[][];
}) {
  return (
    <table aria-label={label} className="sr-only">
      <thead>
        <tr>
          {head.map((h) => (
            <th key={h} scope="col">
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={String(r[0])}>
            {r.map((c, i) => (
              <td key={i}>{c}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/* ------------------------------------------------------------------- bars */

export interface WzBarSeries {
  label: string;
  values: readonly number[];
  /** "54, 162, 235": filled at 20%, edged at 100%, as Workiz's datasets. */
  color: string;
}

/** Chart.js's hover colour (saturate 50%, darken 10%) for Workiz's two series; others keep theirs. */
const HOVER: Record<string, string> = {
  "54, 162, 235": "5, 155, 255",
  "255, 99, 132": "255, 64, 105",
};

/**
 * Workiz's overview bar chart (Chart.js 2, `maintainAspectRatio: false`, 300px
 * tall): the legend centred on top; y ticks from 0 on the left; one category
 * per label, each holding a bar per series; the labels tipped and thinned when
 * crowded. A bar's tooltip names its label and value. Without labels it is an
 * empty 0–1 grid with grey legend boxes, as Workiz draws a period with no job.
 */
export function WzBarChart({
  labels,
  series,
  height = 300,
  className,
  "aria-label": ariaLabel,
}: {
  labels: readonly string[];
  series: readonly WzBarSeries[];
  height?: number;
  className?: string;
  "aria-label": string;
}) {
  const [ref, width] = useWidth<HTMLDivElement>(1000);
  const [hover, setHover] = useState<{ s: number; i: number } | null>(null);
  const n = labels.length;
  const empty = n === 0;

  // Legend band.
  const legendItems = series.map(
    (s) => 40 + FONT_SIZE / 2 + textWidth(s.label),
  );
  const legendWidth = legendItems.reduce((a, w) => a + w + LEGEND_PAD, 0);
  const plotTop = LEGEND_PAD * 2 + FONT_SIZE;

  // Y scale.
  const max = Math.max(0, ...series.flatMap((s) => s.values));
  const ticks = chartTicks(max);
  const top = ticks.at(-1)!;
  const yLabels = ticks.map((t) => tickLabel(t, ticks));
  const yAxisWidth = Math.max(...yLabels.map(textWidth)) + 17.2;

  // X labels: rotation from a first guess at the plot's width, as Chart.js fits it.
  const labelWidth = n ? Math.max(...labels.map(textWidth)) : 0;
  const first = n ? textWidth(labels[0]) : 0;
  const lastW = n ? textWidth(labels[n - 1]) : 0;
  const guess = width - Math.max(yAxisWidth, first / 2 + 3) - (lastW / 2 + 3);
  const { rotation, skip } = xLabelLayout({
    count: n,
    plotWidth: guess,
    labelWidth,
  });
  const rad = (rotation * Math.PI) / 180;
  const padLeft = rotation ? Math.cos(rad) * first + 3 : first / 2 + 3;
  // An empty chart keeps ~31px on the right (rep_jobstats_wz_15_empty_overview).
  const padRight =
    n === 0 ? 30.7 : rotation ? Math.sin(rad) * 5.04 + 3 : lastW / 2 + 3;
  const left = Math.max(yAxisWidth, padLeft);
  const right = width - padRight;
  const plotBottom = height - (28 + Math.sin(rad) * labelWidth);
  const plotH = plotBottom - plotTop;
  const yAt = (v: number) => plotBottom - (v / top) * plotH;

  const cw = n ? (right - left) / n : 0;
  const group = cw * 0.8;
  const barW = series.length ? (group / series.length) * 0.9 : 0;
  const barX = (s: number, i: number) =>
    left + cw * (i + 0.5) - group / 2 + (s + 0.5) * (group / series.length);

  const hovered = hover && {
    x: barX(hover.s, hover.i),
    y: yAt(series[hover.s].values[hover.i] ?? 0),
  };

  return (
    <div
      ref={ref}
      className={cn("relative w-full", className)}
      style={{ height }}
    >
      <svg
        role="img"
        aria-label={ariaLabel}
        width={width}
        height={height}
        className="block"
        style={{ fontFamily: FONT_FAMILY, letterSpacing: 0 }}
      >
        {/* Legend */}
        {series.map((s, i) => {
          const x =
            (width - legendWidth) / 2 +
            LEGEND_PAD +
            legendItems.slice(0, i).reduce((a, w) => a + w + LEGEND_PAD, 0);
          return (
            <g key={s.label}>
              <rect
                x={x + 0.5}
                y={LEGEND_PAD + 0.5}
                width={39}
                height={FONT_SIZE - 1}
                fill={empty ? "rgba(0,0,0,0.1)" : `rgba(${s.color}, 0.2)`}
                stroke={empty ? "rgba(0,0,0,0.1)" : `rgba(${s.color}, 1)`}
              />
              <text
                x={x + 40 + FONT_SIZE / 2}
                y={LEGEND_PAD + FONT_SIZE / 2}
                dominantBaseline="central"
                fontSize={FONT_SIZE}
                fill={TEXT}
              >
                {s.label}
              </text>
            </g>
          );
        })}
        {/* Horizontal grid and the y labels */}
        {ticks.map((t, k) => {
          const y = Math.round(yAt(t)) + 0.5;
          return (
            <g key={t}>
              <line
                x1={left - TICK_MARK}
                x2={right}
                y1={y}
                y2={y}
                stroke={t === 0 ? ZERO : GRID}
              />
              <text
                x={left - TICK_MARK}
                y={y}
                textAnchor="end"
                dominantBaseline="central"
                fontSize={FONT_SIZE}
                fill={TEXT}
              >
                {yLabels[k]}
              </text>
            </g>
          );
        })}
        {/* Vertical grid at the category edges, the y axis's edge first */}
        {(n
          ? Array.from({ length: n + 1 }, (_, k) => left + cw * k)
          : [left]
        ).map((x, k) => (
          <line
            key={k}
            x1={Math.round(x) + 0.5}
            x2={Math.round(x) + 0.5}
            y1={plotTop}
            y2={plotBottom + TICK_MARK}
            stroke={GRID}
          />
        ))}
        {/* Bars: 20% fill, a 1px edge on three sides */}
        {series.map((s, si) =>
          s.values.map((v, i) => {
            if (!(v > 0)) return null;
            const x0 = barX(si, i) - barW / 2;
            const x1 = x0 + barW;
            const y0 = yAt(v);
            const on = hover?.s === si && hover.i === i;
            const rgb = on ? (HOVER[s.color] ?? s.color) : s.color;
            return (
              <g
                key={`${si}-${i}`}
                data-bar
                onMouseEnter={() => setHover({ s: si, i })}
                onMouseLeave={() => setHover(null)}
              >
                <rect
                  x={x0}
                  y={y0}
                  width={barW}
                  height={plotBottom - y0}
                  fill={`rgba(${rgb}, 0.2)`}
                />
                <path
                  d={`M${x0 + 0.5},${plotBottom} V${y0 + 0.5} H${x1 - 0.5} V${plotBottom}`}
                  fill="none"
                  stroke={`rgba(${rgb}, 1)`}
                />
              </g>
            );
          }),
        )}
        {/* X labels, tipped and thinned when crowded */}
        {labels.map((l, i) => {
          if (skip > 1 && i % skip > 0) return null;
          const x = left + cw * (i + 0.5);
          const y = plotBottom + TICK_MARK;
          return rotation ? (
            <text
              key={l}
              x={x}
              y={y + 5}
              transform={`rotate(${-rotation} ${x} ${y + 5})`}
              textAnchor="end"
              dominantBaseline="central"
              fontSize={FONT_SIZE}
              fill={TEXT}
            >
              {l}
            </text>
          ) : (
            <text
              key={l}
              x={x}
              y={y + 1}
              textAnchor="middle"
              dominantBaseline="hanging"
              fontSize={FONT_SIZE}
              fill={TEXT}
            >
              {l}
            </text>
          );
        })}
      </svg>
      {hover && hovered ? (
        <Tooltip
          x={hovered.x}
          y={hovered.y}
          flip={hovered.x > width / 2}
          title={labels[hover.i]}
          lines={[
            {
              color: `rgba(${series[hover.s].color}, 0.2)`,
              text: `${series[hover.s].label}: ${series[hover.s].values[hover.i]}`,
            },
          ]}
        />
      ) : null}
      <DataTable
        label={ariaLabel}
        head={["", ...series.map((s) => s.label)]}
        rows={labels.map((l, i) => [l, ...series.map((s) => s.values[i] ?? 0)])}
      />
    </div>
  );
}

/* ------------------------------------------------------------------- pies */

export interface WzPieSlice {
  key: string;
  name: string;
  value: number;
  color: string;
}

/** An SVG arc from `a0` to `a1` (radians, 0 = 12 o'clock, clockwise). */
function arc(
  cx: number,
  cy: number,
  r: number,
  a0: number,
  a1: number,
): string {
  if (a1 - a0 >= Math.PI * 2 - 1e-9) {
    return `M${cx},${cy - r} A${r},${r} 0 1 1 ${cx - 0.01},${cy - r} Z`;
  }
  const p = (a: number) => `${cx + r * Math.sin(a)},${cy - r * Math.cos(a)}`;
  return `M${cx},${cy} L${p(a0)} A${r},${r} 0 ${a1 - a0 > Math.PI ? 1 : 0} 1 ${p(a1)} Z`;
}

/**
 * Workiz's breakdown pie (Chart.js 2 `pie`, aspect 2:1): slices from 12
 * o'clock, clockwise, 2px white edges; the legend below in centred lines of
 * 10×12 boxes and 12px #666 names. Without slices: "No data found" (h3,
 * 18px/25px #3e4b51) right under the title with 21px below it, as Workiz
 * writes it (rep_jobstats_wz_15_empty_sources).
 */
export function WzPieChart({
  slices,
  format = (v: number) => String(v),
  className,
  "aria-label": ariaLabel,
}: {
  slices: readonly WzPieSlice[];
  format?: (value: number) => string;
  className?: string;
  "aria-label": string;
}) {
  const [ref, width] = useWidth<HTMLDivElement>(680);
  const [hover, setHover] = useState<number | null>(null);
  if (!slices.length) {
    return (
      <div ref={ref} className={className}>
        <p className="pb-[21px] text-center text-lg leading-[25px] text-wz-tab-bar">
          No data found
        </p>
      </div>
    );
  }
  const height = Math.floor(width / 2);
  const items = slices.map((s) => 10 + FONT_SIZE / 2 + textWidth(s.name));
  const lines = legendLines(items, width);
  const { areaHeight, radius, legendTop } = pieLayout({
    width,
    height,
    lines: lines.length,
  });
  const total = slices.reduce((a, s) => a + Math.max(0, s.value), 0) || 1;
  const cx = width / 2;
  const cy = areaHeight / 2;
  let angle = 0;
  const arcs = slices.map((s) => {
    const a0 = angle;
    angle += (Math.max(0, s.value) / total) * Math.PI * 2;
    return { a0, a1: angle };
  });

  let legend: ReactNode[] = [];
  lines.forEach((line, li) => {
    let x = (width - line.width) / 2 + LEGEND_PAD;
    const y = legendTop + LEGEND_PAD + li * (FONT_SIZE + LEGEND_PAD);
    legend = legend.concat(
      line.items.map((i) => {
        const at = x;
        x += items[i] + LEGEND_PAD;
        return (
          <g key={slices[i].key}>
            <rect
              x={at}
              y={y}
              width={10}
              height={FONT_SIZE}
              fill={slices[i].color}
              stroke="#ffffff"
              strokeWidth={2}
            />
            <text
              x={at + 10 + FONT_SIZE / 2}
              y={y + FONT_SIZE / 2}
              dominantBaseline="central"
              fontSize={FONT_SIZE}
              fill={TEXT}
            >
              {slices[i].name}
            </text>
          </g>
        );
      }),
    );
  });

  const tip = hover !== null && radius > 0 ? arcs[hover] : null;
  const mid = tip ? (tip.a0 + tip.a1) / 2 : 0;

  return (
    <div
      ref={ref}
      className={cn("relative w-full", className)}
      style={{ height }}
    >
      <svg
        role="img"
        aria-label={ariaLabel}
        width={width}
        height={height}
        className="block overflow-hidden"
        style={{ fontFamily: FONT_FAMILY, letterSpacing: 0 }}
      >
        {radius > 0
          ? slices.map((s, i) => (
              <path
                key={s.key}
                d={arc(cx, cy, radius, arcs[i].a0, arcs[i].a1)}
                fill={s.color}
                stroke="#ffffff"
                strokeWidth={2}
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover(null)}
              />
            ))
          : null}
        {legend}
      </svg>
      {tip && hover !== null ? (
        <Tooltip
          x={cx + (radius / 2) * Math.sin(mid)}
          y={cy - (radius / 2) * Math.cos(mid)}
          flip={Math.sin(mid) > 0}
          lines={[
            {
              color: slices[hover].color,
              text: `${slices[hover].name}: ${format(slices[hover].value)}`,
            },
          ]}
        />
      ) : null}
      <DataTable
        label={ariaLabel}
        head={["Name", "Value"]}
        rows={slices.map((s) => [s.name, format(s.value)])}
      />
    </div>
  );
}
