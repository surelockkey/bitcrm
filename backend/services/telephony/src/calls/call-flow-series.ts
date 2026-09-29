import type { CallFlowSeries } from '@bitcrm/types';

/** Lines on "Top Call Flows" — Workiz's legend already scrolls at nine. */
export const TOP_FLOWS = 8;

/** Every day from `from` to `to`, inclusive. */
function daysOf(from: string, to: string): string[] {
  const out: string[] = [];
  for (let t = Date.parse(`${from}T00:00:00Z`); t <= Date.parse(`${to}T00:00:00Z`); t += 86_400_000) {
    out.push(new Date(t).toISOString().slice(0, 10));
  }
  return out;
}

/**
 * The "Top Call Flows" chart from a tally of calls by flow and day: the
 * busiest flows over the window, each a line with a point on every day —
 * zeros included, since a missing day would break the line.
 */
export function callFlowSeries(
  byFlow: Record<string, Record<string, number>>,
  window: { from: string; to: string },
  atLeast: boolean,
): CallFlowSeries {
  const days = daysOf(window.from, window.to);
  const flows = Object.entries(byFlow)
    .map(([name, byDay]) => ({ name, counts: days.map((d) => byDay[d] ?? 0) }))
    .map((f) => ({ ...f, total: f.counts.reduce((a, b) => a + b, 0) }))
    .filter((f) => f.total > 0)
    .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name))
    .slice(0, TOP_FLOWS)
    .map(({ name, counts }) => ({ name, counts }));
  return { days, flows, atLeast };
}
