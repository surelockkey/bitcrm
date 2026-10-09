import { describe, expect, it } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { areaLayout, areaPoints, chartLinearTicks, nearestPoint, WZ_AREA_FALLBACK_WIDTH, WzAreaChart } from "./area-chart";

describe("chartLinearTicks — Chart.js 2's linear scale", () => {
  it("steps nicely from the data's floor to past its top", () => {
    expect(chartLinearTicks(0, 41)).toEqual([0, 5, 10, 15, 20, 25, 30, 35, 40, 45]);
    expect(chartLinearTicks(0, 265)).toEqual([0, 50, 100, 150, 200, 250, 300]);
    // rep_calltracking_wz_11_preset_today: 0 … 2.0 by 0.2.
    expect(chartLinearTicks(0, 2)).toEqual([0, 0.2, 0.4, 0.6, 0.8, 1, 1.2, 1.4, 1.6, 1.8, 2]);
  });

  it("opens a flat line out by one each way, and asks fewer ticks of a short axis", () => {
    expect(chartLinearTicks(5, 5)[0]).toBe(4);
    expect(chartLinearTicks(5, 5).at(-1)).toBe(6);
    expect(chartLinearTicks(0, 41, 4)).toEqual([0, 20, 40, 60]);
  });
});

describe("areaLayout — where Chart.js puts the plot", () => {
  it("tilts crowded labels and makes room for the first one on the left (rep_calltracking_wz_01_default)", () => {
    const hours = Array.from({ length: 24 }, (_, h) => `${h % 12 || 12}:00 ${h < 12 ? "AM" : "PM"}`);
    const l = areaLayout({ width: 1360, height: 272, labels: hours, min: 0, max: 41 });
    // Workiz: 21.07°, plot from x 56.7 to 1354.4, y 7.2 to 235.6.
    expect(l.rotation).toBeGreaterThan(18);
    expect(l.rotation).toBeLessThan(24);
    expect(l.top).toBeCloseTo(7.2, 1);
    expect(l.left).toBeGreaterThan(48);
    expect(l.left).toBeLessThan(62);
    expect(l.right).toBeCloseTo(1354.4, 0);
    expect(l.bottom).toBeGreaterThan(230);
    expect(l.bottom).toBeLessThan(241);
    expect(l.ticks.at(-1)).toBe(45);
  });

  it("keeps short labels level, half a label in from each end", () => {
    const days = ["10/01/26", "10/02/26", "10/03/26"];
    const l = areaLayout({ width: 1360, height: 272, labels: days, min: 0, max: 46 });
    expect(l.rotation).toBe(0);
    // Workiz's day chart: the plot ends 28.6px short of the right edge, 30.16px over the bottom.
    expect(1360 - l.right).toBeGreaterThan(24);
    expect(1360 - l.right).toBeLessThan(33);
    expect(272 - l.bottom).toBeCloseTo(30.16, 1);
  });
});

describe("nearestPoint — Chart.js's 'nearest' tooltip, intersecting", () => {
  it("finds the point under the pointer within its radius and hit radius, else nothing", () => {
    const points = [
      [
        { x: 10, y: 10 },
        { x: 50, y: 20 },
      ],
      [
        { x: 10, y: 12 },
        { x: 50, y: 40 },
      ],
    ];
    expect(nearestPoint(points, 50, 21)).toEqual({ series: 0, index: 1 });
    expect(nearestPoint(points, 10, 12)).toEqual({ series: 1, index: 0 });
    expect(nearestPoint(points, 30, 30)).toBeNull();
  });
});

describe("WzAreaChart", () => {
  const props = {
    "aria-label": "Calls per call flow",
    labels: ["12:00 AM", "1:00 AM", "2:00 AM"],
    series: [
      { label: "(2-CT-O) SURE CT ORGANIC", values: [1, 4, 2], color: "var(--wz-series1)" },
      { label: "(3-TX-GMB) SURE TX GMB", values: [0, 2, 3], color: "rgb(1 2 3)" },
    ],
  };

  it("draws an area and a line per flow, and Workiz's legend of boxes and names", () => {
    const { container } = render(<WzAreaChart {...props} />);
    expect(screen.getByRole("img", { name: "Calls per call flow" })).toBeInTheDocument();
    expect(container.querySelectorAll('[data-slot="wz-area-fill"]')).toHaveLength(2);
    expect(container.querySelectorAll('[data-slot="wz-area-line"]')).toHaveLength(2);
    const legend = screen.getByRole("list", { name: "Calls per call flow legend" });
    expect(within(legend).getAllByRole("listitem").map((li) => li.textContent)).toEqual([
      "(2-CT-O) SURE CT ORGANIC",
      "(3-TX-GMB) SURE TX GMB",
    ]);
  });

  it("names a point under the pointer in Chart.js's tooltip: the bucket over \"flow: calls\"", () => {
    const { container } = render(<WzAreaChart {...props} />);
    const hit = container.querySelector('[data-slot="wz-area-hit"]') as SVGElement;
    // Unmeasured (jsdom) the canvas keeps its fallback width, a fifth as tall.
    const width = WZ_AREA_FALLBACK_WIDTH;
    const layout = areaLayout({ width, height: width / 5, labels: props.labels, min: 0, max: 4 });
    const p = areaPoints(layout, props.series, 3)[0][1];
    fireEvent.mouseMove(hit, { clientX: p.x, clientY: p.y });
    const tip = screen.getByRole("tooltip");
    expect(tip).toHaveTextContent("1:00 AM");
    expect(tip).toHaveTextContent("(2-CT-O) SURE CT ORGANIC: 4");
    fireEvent.mouseLeave(hit);
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("gives screen readers the calls of every bucket", () => {
    render(<WzAreaChart {...props} />);
    const table = screen.getByRole("table", { name: "Calls per call flow" });
    expect(within(table).getAllByRole("row")).toHaveLength(4);
    expect(within(table).getByRole("row", { name: /1:00 AM/ })).toHaveTextContent("6");
  });
});
