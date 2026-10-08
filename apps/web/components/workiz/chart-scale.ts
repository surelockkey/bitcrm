/**
 * The arithmetic behind Workiz's dashboard charts.
 *
 * Their bar and line charts are chart.js 2 on its defaults, so the y axis is
 * chart.js's linear scale: at most eleven ticks, a "nice" spacing (1, 2, 5 or
 * 10 × 10ⁿ) and the top rounded up to the next step — 220 jobs draw an axis
 * 0..250 by 50, $38,500 one 0..40,000 by 5,000 (pg_dashboard_wz_home).
 */

/** chart.js 2's `helpers.niceNum` without rounding: the smallest 1/2/5/10 × 10ⁿ at or above `range`. */
function niceNum(range: number): number {
  const exponent = Math.floor(Math.log10(range));
  const fraction = range / 10 ** exponent;
  const nice = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10;
  return nice * 10 ** exponent;
}

/** Rounds away binary dust (0.30000000000000004) without touching real digits. */
const clean = (n: number): number => Number(n.toPrecision(12));

/**
 * The y ticks for a chart whose tallest value is `max`, bottom first. An
 * empty chart gets chart.js's 0..1, so the axis still stands.
 */
export function wzChartTicks(max: number, maxTicks = 11): number[] {
  const top = max > 0 ? max : 1;
  const spaces = maxTicks - 1;
  let spacing = niceNum(top / spaces);
  const count = Math.ceil(clean(top / spacing));
  if (count > spaces) spacing = niceNum((count * spacing) / spaces);
  const n = Math.ceil(clean(top / spacing));
  return Array.from({ length: n + 1 }, (_, i) => clean(i * spacing));
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function ordinal(n: number): string {
  if (n % 100 >= 11 && n % 100 <= 13) return "th";
  return ["th", "st", "nd", "rd"][n % 10] ?? "th";
}

/** `2026-09-24` → `Sep 24th`, the bar charts' axis label. */
export function wzDayLabel(day: string): string {
  const [, m, d] = day.split("-").map(Number);
  return `${MONTHS[m - 1]} ${d}${ordinal(d)}`;
}

/** `2026-09-24` → `09/24/26`, the line chart's axis label. */
export function wzSlashDay(day: string): string {
  const [y, m, d] = day.split("-");
  return `${m}/${d}/${y.slice(2)}`;
}

/** chart.js 2's default tick font: 12px, line height 1.2. */
const LABEL_HEIGHT = 14.4;
const MAX_ROTATION = 50;

/**
 * How chart.js 2 lays out a category axis's labels: tilted just enough to
 * clear the neighbours (`asin((h + 6) / tickWidth)`, at most 50°), and when
 * even the full tilt is too crowded, only every n-th label is drawn (its
 * auto-skip). `offset` is a bar chart's axis, whose categories sit between
 * the ticks; `labelWidth` is the widest label's width in px.
 */
export function wzAxisLabels(
  count: number,
  plotWidth: number,
  offset: boolean,
  labelWidth = 50,
): { rotation: number; every: number } {
  if (count < 1 || plotWidth <= 0) return { rotation: 0, every: 1 };
  const tickWidth = plotWidth / Math.max(1, count - (offset ? 0.5 : 1));
  let rotation = 0;
  if (labelWidth + 6 > tickWidth) {
    const lean = (Math.asin(Math.min((LABEL_HEIGHT + 6) / tickWidth, 1)) * 180) / Math.PI;
    rotation = Math.min(MAX_ROTATION, lean);
  }
  const rad = (rotation * Math.PI) / 180;
  const cos = Math.abs(Math.cos(rad));
  const sin = Math.abs(Math.sin(rad));
  const tickSize = LABEL_HEIGHT * cos > labelWidth * sin ? labelWidth / cos : LABEL_HEIGHT / sin;
  const limit = plotWidth / tickSize + 1;
  return { rotation, every: count > limit ? Math.ceil(count / limit) : 1 };
}

/**
 * Which side of its point chart.js 2 opens a tooltip on: level with the
 * point, towards the middle of the chart (its `yAlign: center` rule), unless
 * the point is too near the top for the tooltip's height — then underneath.
 */
export function wzTipSide(x: number, y: number, chartWidth: number, tipHeight: number): "right" | "left" | "below" {
  if (y < tipHeight / 2) return "below";
  return x <= chartWidth / 2 ? "right" : "left";
}

export interface WzPieSlice {
  /** Where the slice starts and ends, as a fraction of the turn from twelve o'clock. */
  start: number;
  end: number;
  path: string;
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;

function onCircle(turn: number, cx: number, cy: number, r: number): string {
  const angle = turn * 2 * Math.PI;
  return `${round3(cx + r * Math.sin(angle))} ${round3(cy - r * Math.cos(angle))}`;
}

/**
 * A pie's wedges in a 100×100 box, clockwise from twelve o'clock in the order
 * given (chart.js's start angle). A lone slice is the whole circle — two half
 * arcs, since an arc that ends where it began draws nothing.
 */
export function wzPieSlices(values: number[], { cx = 50, cy = 50, r = 50 } = {}): WzPieSlice[] {
  const total = values.reduce((a, b) => a + Math.max(0, b), 0);
  if (total <= 0) return [];
  let start = 0;
  return values.map((value) => {
    const end = start + Math.max(0, value) / total;
    const path =
      end - start >= 1 - 1e-9
        ? `M ${onCircle(0, cx, cy, r)} A ${r} ${r} 0 1 1 ${onCircle(0.5, cx, cy, r)} A ${r} ${r} 0 1 1 ${onCircle(0, cx, cy, r)} Z`
        : `M ${cx} ${cy} L ${onCircle(start, cx, cy, r)} A ${r} ${r} 0 ${end - start > 0.5 ? 1 : 0} 1 ${onCircle(end, cx, cy, r)} Z`;
    const slice = { start: round3(start), end: round3(end), path };
    start = end;
    return slice;
  });
}

export interface WzPoint {
  x: number;
  y: number;
}

/**
 * A line through `points` the way chart.js 2 draws one by default: a cubic
 * Bézier per segment with `helpers.splineCurve`'s handles (tension .4, the
 * first and last point their own neighbours), each handle kept between 0 and
 * `height` as `capBezierPoints` does, so a curve never dives under the axis.
 */
export function wzSpline(points: WzPoint[], height: number, tension = 0.4): string {
  if (!points.length) return "";
  const cap = (y: number) => Math.min(height, Math.max(0, y));
  const handles = points.map((cur, i) => {
    const prev = points[Math.max(0, i - 1)];
    const next = points[Math.min(points.length - 1, i + 1)];
    const d01 = Math.hypot(cur.x - prev.x, cur.y - prev.y);
    const d12 = Math.hypot(next.x - cur.x, next.y - cur.y);
    const sum = d01 + d12;
    const fa = sum ? (tension * d01) / sum : 0;
    const fb = sum ? (tension * d12) / sum : 0;
    return {
      before: { x: cur.x - fa * (next.x - prev.x), y: cap(cur.y - fa * (next.y - prev.y)) },
      after: { x: cur.x + fb * (next.x - prev.x), y: cap(cur.y + fb * (next.y - prev.y)) },
    };
  });
  const n = (v: number) => String(round3(v));
  let d = `M ${n(points[0].x)} ${n(points[0].y)}`;
  for (let i = 1; i < points.length; i++) {
    const a = handles[i - 1].after;
    const b = handles[i].before;
    d += ` C ${n(a.x)} ${n(a.y)} ${n(b.x)} ${n(b.y)} ${n(points[i].x)} ${n(points[i].y)}`;
  }
  return d;
}
