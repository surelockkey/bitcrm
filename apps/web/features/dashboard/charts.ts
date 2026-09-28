/**
 * The geometry behind the dashboard's charts, kept apart from React: a wedge
 * that must become a whole circle, a line over one day, a bar wider than its
 * card — this is where charts go wrong, and it is all arithmetic.
 */

/** 1 / 2 / 5 × 10ⁿ at or above `max` — the top of an axis. */
export function niceMax(max: number): number {
  if (max <= 0) return 1;
  const pow = 10 ** Math.floor(Math.log10(max));
  const step = [1, 2, 5, 10].find((s) => s * pow >= max) ?? 10;
  return step * pow;
}

export interface PieSlice {
  /** Where the slice starts and ends, as a fraction of the turn from twelve o'clock. */
  start: number;
  end: number;
  path: string;
}

const round = (n: number) => Math.round(n * 1000) / 1000;

/** The point `turn` of the way round a circle, clockwise from twelve o'clock. */
function at(turn: number, cx: number, cy: number, r: number): string {
  const angle = turn * 2 * Math.PI;
  return `${round(cx + r * Math.sin(angle))} ${round(cy - r * Math.cos(angle))}`;
}

/**
 * A pie's wedges, clockwise from twelve o'clock in the order given. A lone
 * slice is drawn as the whole circle — two half arcs, since an SVG arc that
 * ends where it began draws nothing.
 */
export function pieSlices(
  values: number[],
  { cx = 50, cy = 50, r = 50 }: { cx?: number; cy?: number; r?: number } = {},
): PieSlice[] {
  const total = values.reduce((a, b) => a + Math.max(0, b), 0);
  if (total <= 0) return [];
  let start = 0;
  return values.map((value) => {
    const end = start + Math.max(0, value) / total;
    const whole = end - start >= 1 - 1e-9;
    const path = whole
      ? `M ${at(0, cx, cy, r)} A ${r} ${r} 0 1 1 ${at(0.5, cx, cy, r)} A ${r} ${r} 0 1 1 ${at(0, cx, cy, r)} Z`
      : `M ${cx} ${cy} L ${at(start, cx, cy, r)} A ${r} ${r} 0 ${end - start > 0.5 ? 1 : 0} 1 ${at(end, cx, cy, r)} Z`;
    const slice = { start: round(start), end: round(end), path };
    start = end;
    return slice;
  });
}

/**
 * A series as points on a plot `width` × `height`, the first day on the left
 * edge and the last on the right, `top` at the top. One day sits mid-plot.
 */
export function linePoints(
  values: number[],
  { width, height, top }: { width: number; height: number; top: number },
): { x: number; y: number }[] {
  const step = values.length > 1 ? width / (values.length - 1) : 0;
  return values.map((v, i) => ({
    x: values.length > 1 ? round(i * step) : width / 2,
    y: round(height - (Math.max(0, v) / (top || 1)) * height),
  }));
}

/** A scoreboard bar's width: the value against the leader's, 0–100. */
export function barPercent(value: number, leader: number): number {
  if (leader <= 0 || value <= 0) return 0;
  return Math.min(100, (value / leader) * 100);
}

/**
 * The letter in a scoreboard avatar. Workiz names people "(1) (Betty) …" and
 * "(2) TX - Daniel …"; their avatar shows the bracket, which says nothing, so
 * this skips to the first letter.
 */
export function scoreInitial(name: string): string {
  const letter = name.match(/\p{L}/u)?.[0];
  return letter ? letter.toUpperCase() : "?";
}
