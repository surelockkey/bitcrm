import { describe, expect, it } from "vitest";
import { barPercent, linePoints, niceMax, pieSlices, scoreInitial } from "./charts";

/**
 * Геометрія графіків дашборда — окремо від React, бо саме тут помиляються:
 * сектор на все коло, лінія без даних, смуга ширша за картку.
 */
describe("niceMax", () => {
  it("rounds the top of the axis up to 1 / 2 / 5 × 10ⁿ", () => {
    expect(niceMax(76)).toBe(100);
    expect(niceMax(80_000)).toBe(100_000);
    expect(niceMax(17)).toBe(20);
    expect(niceMax(42)).toBe(50);
  });

  it("an empty chart still has an axis", () => {
    expect(niceMax(0)).toBe(1);
  });
});

describe("pieSlices", () => {
  it("one slice per value, clockwise from twelve o'clock, adding up to the whole turn", () => {
    const slices = pieSlices([1, 1, 2]);

    expect(slices.map((s) => [s.start, s.end])).toEqual([
      [0, 0.25],
      [0.25, 0.5],
      [0.5, 1],
    ]);
  });

  it("each slice is an SVG wedge from the centre", () => {
    const [slice] = pieSlices([1, 3], { cx: 50, cy: 50, r: 40 });

    // From the centre, up to twelve o'clock, an arc a quarter round, back.
    expect(slice.path).toBe("M 50 50 L 50 10 A 40 40 0 0 1 90 50 Z");
  });

  it("a slice over half the pie takes the large arc", () => {
    const [, big] = pieSlices([1, 3], { cx: 50, cy: 50, r: 40 });

    expect(big.path).toContain("A 40 40 0 1 1");
  });

  it("a lone slice is the whole circle — an arc cannot end where it began", () => {
    const [only] = pieSlices([5], { cx: 50, cy: 50, r: 40 });

    expect(only.path).toBe("M 50 10 A 40 40 0 1 1 50 90 A 40 40 0 1 1 50 10 Z");
  });

  it("nothing to draw when every value is zero", () => {
    expect(pieSlices([0, 0])).toEqual([]);
  });
});

describe("linePoints", () => {
  it("spreads the days across the width and scales values against the top", () => {
    expect(linePoints([0, 50, 100], { width: 200, height: 100, top: 100 })).toEqual([
      { x: 0, y: 100 },
      { x: 100, y: 50 },
      { x: 200, y: 0 },
    ]);
  });

  it("a single day sits in the middle", () => {
    expect(linePoints([10], { width: 200, height: 100, top: 20 })).toEqual([{ x: 100, y: 50 }]);
  });
});

describe("barPercent", () => {
  it("is the value against the leader", () => {
    expect(barPercent(27_240.25, 114_383.07)).toBeCloseTo(23.81, 1);
  });

  it("never past the card, never below nothing", () => {
    expect(barPercent(5, 0)).toBe(0);
    expect(barPercent(-1, 10)).toBe(0);
    expect(barPercent(20, 10)).toBe(100);
  });
});

describe("scoreInitial", () => {
  it("the first letter of the name, past Workiz-style prefixes like (1) or (2) TX -", () => {
    expect(scoreInitial("(1) (Betty) Platinum Manager")).toBe("B");
    expect(scoreInitial("(2) TX - Daniel Munoz")).toBe("T");
    expect(scoreInitial("daniel")).toBe("D");
  });

  it("a question mark for somebody without a name", () => {
    expect(scoreInitial("")).toBe("?");
  });
});
