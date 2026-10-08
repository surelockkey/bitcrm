import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  WzBarChart,
  WzPieChart,
  chartTicks,
  legendLines,
  pieLayout,
  tickLabel,
  xLabelLayout,
} from "./charts";

/*
 * The numbers here are Chart.js's own, read off Workiz's live charts
 * (rep_jobstats probe: Chart.instances' scales, legend hit boxes, arcs).
 */

describe("chartTicks — Chart.js's linear scale, beginAtZero, up to 11 ticks", () => {
  it("steps October's jobs by 20 to 160 and its sales by 5000 to 30000", () => {
    expect(chartTicks(141)).toEqual([0, 20, 40, 60, 80, 100, 120, 140, 160]);
    expect(chartTicks(25926.58)).toEqual([
      0, 5000, 10000, 15000, 20000, 25000, 30000,
    ]);
  });

  it("steps September's by 50 to 250 and by 10000 to 90000", () => {
    expect(chartTicks(225)).toEqual([0, 50, 100, 150, 200, 250]);
    expect(chartTicks(80612.4).at(-1)).toBe(90000);
  });

  it("draws an empty chart from 0 to 1 by tenths", () => {
    expect(chartTicks(0)).toEqual([
      0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1,
    ]);
  });

  it("labels the ticks as Chart.js does: no grouping, the step's decimals", () => {
    expect(tickLabel(30000, [0, 5000, 10000])).toBe("30000");
    expect(tickLabel(0, [0, 0.1, 0.2])).toBe("0");
    expect(tickLabel(0.1, [0, 0.1, 0.2])).toBe("0.1");
    expect(tickLabel(1, [0, 0.1, 0.2])).toBe("1.0");
  });
});

describe("xLabelLayout — rotate, then skip, as Workiz's Chart.js does", () => {
  it("keeps eight days flat and every label", () => {
    expect(
      xLabelLayout({ count: 8, plotWidth: 946, labelWidth: 65.37 }),
    ).toEqual({ rotation: 0, skip: 1 });
  });

  it("tips thirty days to 50° and shows every other one", () => {
    expect(
      xLabelLayout({ count: 30, plotWidth: 967, labelWidth: 65.37 }),
    ).toEqual({ rotation: 50, skip: 2 });
  });
});

describe("pie legend", () => {
  it("wraps the items into centred lines 10px apart", () => {
    const lines = legendLines([100, 100, 100], 250);
    expect(lines).toEqual([
      { items: [0, 1], width: 220 },
      { items: [2], width: 110 },
    ]);
  });

  it("gives the pie what the legend leaves — Dispatcher's 9 lines leave 133px and a 64.5px radius", () => {
    expect(pieLayout({ width: 683, height: 341, lines: 9 })).toEqual({
      areaHeight: 133,
      radius: 64.5,
      legendTop: 133,
    });
  });

  it("lets a legend taller than the box swallow the pie, its first lines off the top", () => {
    const l = pieLayout({ width: 683, height: 341, lines: 30 });
    expect(l.radius).toBe(0);
    expect(l.legendTop).toBe(341 - (10 + 30 * 22));
  });
});

describe("WzBarChart", () => {
  it("names itself, lists its series in the legend and its numbers in a table for a screen reader", () => {
    render(
      <WzBarChart
        aria-label="Jobs and Canceled"
        labels={["10/01/2026", "10/02/2026"]}
        series={[
          { label: "Jobs", values: [102, 141], color: "54, 162, 235" },
          { label: "Canceled", values: [72, 95], color: "255, 99, 132" },
        ]}
      />,
    );
    expect(
      screen.getByRole("img", { name: "Jobs and Canceled" }),
    ).toBeInTheDocument();
    const table = screen.getByRole("table", { name: "Jobs and Canceled" });
    expect(table).toHaveTextContent("10/02/2026");
    expect(table).toHaveTextContent("141");
  });

  it("shows a bar's day and value in Chart.js's tooltip on hover", () => {
    const { container } = render(
      <WzBarChart
        aria-label="Jobs"
        labels={["10/03/2026"]}
        series={[{ label: "Jobs", values: [122], color: "54, 162, 235" }]}
      />,
    );
    const bar = container.querySelector("[data-bar]")!;
    fireEvent.mouseEnter(bar);
    expect(screen.getByRole("tooltip")).toHaveTextContent("10/03/2026");
    expect(screen.getByRole("tooltip")).toHaveTextContent("Jobs: 122");
  });
});

describe("WzPieChart", () => {
  it("draws a slice per value with a legend entry each, and says No data found without any", () => {
    const { rerender } = render(
      <WzPieChart
        aria-label="Tech by done jobs"
        slices={[
          { key: "a", name: "Ann", value: 3, color: "#FF6633" },
          { key: "b", name: "Bob", value: 1, color: "#FFB399" },
        ]}
      />,
    );
    expect(
      screen.getByRole("img", { name: "Tech by done jobs" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("table", { name: "Tech by done jobs" }),
    ).toHaveTextContent("Ann3");
    rerender(<WzPieChart aria-label="Tech by done jobs" slices={[]} />);
    expect(screen.getByText("No data found")).toBeInTheDocument();
  });
});
