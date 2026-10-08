import { describe, expect, it } from "vitest";
import { wzAxisLabels, wzChartTicks, wzDayLabel, wzPieSlices, wzSlashDay, wzSpline, wzTipSide } from "./chart-scale";

/**
 * Workiz's dashboard charts are chart.js 2 with its default linear scale, so
 * the axis steps are chart.js's: a "nice" spacing from at most ten spaces
 * (pg_dashboard_wz_home — Jobs By Status 0..250 by 50, Sales 0..40000 by
 * 5000, Top Call Flows 0..70 by 10).
 */
describe("wzChartTicks", () => {
  it("steps a jobs chart topping 220 by 50 up to 250", () => {
    expect(wzChartTicks(220)).toEqual([0, 50, 100, 150, 200, 250]);
  });

  it("steps a sales chart topping 38,500 by 5,000 up to 40,000", () => {
    expect(wzChartTicks(38_500)).toEqual([0, 5000, 10000, 15000, 20000, 25000, 30000, 35000, 40000]);
  });

  it("steps a call-flow chart topping 65 by 10 up to 70", () => {
    expect(wzChartTicks(65)).toEqual([0, 10, 20, 30, 40, 50, 60, 70]);
  });

  it("lands exactly on a round maximum", () => {
    expect(wzChartTicks(100)).toEqual([0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100]);
  });

  it("steps small counts by halves, as chart.js does", () => {
    expect(wzChartTicks(3)).toEqual([0, 0.5, 1, 1.5, 2, 2.5, 3]);
  });

  it("gives an empty chart a 0..1 axis instead of nothing", () => {
    expect(wzChartTicks(0)).toEqual([0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1]);
  });

  it("never carries floating-point dust into a label", () => {
    for (const t of wzChartTicks(0.7)) expect(String(t).length).toBeLessThan(5);
  });
});

describe("wzDayLabel", () => {
  it("writes a day as Workiz's bar axis does", () => {
    expect(wzDayLabel("2026-09-24")).toBe("Sep 24th");
    expect(wzDayLabel("2026-10-01")).toBe("Oct 1st");
    expect(wzDayLabel("2026-10-02")).toBe("Oct 2nd");
    expect(wzDayLabel("2026-10-03")).toBe("Oct 3rd");
    expect(wzDayLabel("2026-10-11")).toBe("Oct 11th");
    expect(wzDayLabel("2026-10-22")).toBe("Oct 22nd");
  });
});

describe("wzSlashDay", () => {
  it("writes a day as Workiz's line axis does", () => {
    expect(wzSlashDay("2026-09-24")).toBe("09/24/26");
  });
});

/**
 * chart.js 2 tilts the x labels just enough to clear their neighbours (at most
 * 50°) and, when even that is not enough, shows every n-th one. Workiz's 15
 * days across a 570px plot lean about 30° (pg_dashboard_wz_home).
 */
describe("wzAxisLabels", () => {
  it("leans fifteen days across a two-column card about thirty degrees, every one shown", () => {
    const { rotation, every } = wzAxisLabels(15, 570, true);
    expect(rotation).toBeGreaterThan(28);
    expect(rotation).toBeLessThan(33);
    expect(every).toBe(1);
  });

  it("stands a month of days at fifty degrees, still every one", () => {
    expect(wzAxisLabels(31, 570, true)).toEqual({ rotation: 50, every: 1 });
  });

  it("thins three months of days to every third", () => {
    expect(wzAxisLabels(92, 570, true)).toEqual({ rotation: 50, every: 3 });
  });

  it("lays a few wide days flat", () => {
    expect(wzAxisLabels(3, 570, true).rotation).toBe(0);
  });
});

describe("wzPieSlices", () => {
  it("starts at twelve o'clock and goes clockwise", () => {
    const [a, b] = wzPieSlices([1, 1]);
    expect(a.path.startsWith("M 50 50 L 50 0 A 50 50 0 0 1 50 100")).toBe(true);
    expect(b.path.startsWith("M 50 50 L 50 100")).toBe(true);
  });

  it("draws a lone slice as a whole circle", () => {
    const [only] = wzPieSlices([5]);
    expect(only.path).toContain("A 50 50 0 1 1 50 100");
    expect(only.path).toContain("A 50 50 0 1 1 50 0");
  });

  it("draws nothing for nothing", () => {
    expect(wzPieSlices([0, 0])).toEqual([]);
  });
});

/**
 * Where chart.js 2 puts its tooltip: level with the point, on the side with
 * room (the left half of the chart opens to the right — pg_dashboard_wz_bar_hover),
 * or under the point when it is too near the top for that.
 */
describe("wzTipSide", () => {
  it("opens to the right of a point in the left half", () => {
    expect(wzTipSide(50, 120, 600, 40)).toBe("right");
  });

  it("opens to the left of a point in the right half", () => {
    expect(wzTipSide(450, 120, 600, 40)).toBe("left");
  });

  it("hangs under a point too near the top", () => {
    expect(wzTipSide(300, 10, 600, 40)).toBe("below");
  });
});

/** chart.js 2's default curve (tension .4), its control points kept inside the plot. */
describe("wzSpline", () => {
  it("draws two points as a straight run", () => {
    expect(wzSpline([{ x: 0, y: 10 }, { x: 100, y: 10 }], 100)).toBe("M 0 10 C 40 10 60 10 100 10");
  });

  it("bends through a peak with handles level with it", () => {
    const d = wzSpline([{ x: 0, y: 100 }, { x: 50, y: 0 }, { x: 100, y: 100 }], 100);
    expect(d).toBe("M 0 100 C 20 60 30 0 50 0 C 70 0 80 60 100 100");
  });

  it("never lets a handle leave the plot", () => {
    const d = wzSpline([{ x: 0, y: 0 }, { x: 10, y: 100 }, { x: 20, y: 0 }, { x: 30, y: 100 }], 100);
    for (const n of d.match(/-?\d+(\.\d+)?/g)!.map(Number)) {
      expect(n).toBeGreaterThanOrEqual(0);
      expect(n).toBeLessThanOrEqual(100);
    }
  });
});
