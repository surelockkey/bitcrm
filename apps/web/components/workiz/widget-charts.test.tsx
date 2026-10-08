import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { WzWidgetBarChart, WzWidgetLineChart, WzWidgetPie } from "./widget-charts";

const DAYS = ["2026-09-24", "2026-09-25", "2026-09-26"];

/** Workiz Home's chart.js bar charts — Jobs By Status, Sales. */
describe("WzWidgetBarChart", () => {
  const series = [
    { label: "Canceled", color: "var(--wz-chart-canceled)", values: [86, 0, 40] },
    { label: "Done", color: "var(--wz-chart-done)", values: [38, 220, 25] },
  ];

  it("stands on chart.js's axis — 0 to 250 by 50 for a 220 peak", () => {
    render(<WzWidgetBarChart title="Jobs by status" days={DAYS} series={series} />);
    const ticks = [...document.querySelectorAll("[data-slot=wz-chart-ytick]")].map((t) => t.textContent);
    expect(ticks).toEqual(["0", "50", "100", "150", "200", "250"]);
  });

  it("draws a bar per series per day, as tall as its share of the axis", () => {
    render(<WzWidgetBarChart title="Jobs by status" days={DAYS} series={series} />);
    const bars = [...document.querySelectorAll<HTMLElement>("[data-slot=wz-chart-bar]")];
    expect(bars).toHaveLength(6);
    // Sep 24th's Canceled (86 of 250) and Sep 25th's Done (220 of 250).
    expect(bars[0].dataset.series).toBe("Canceled");
    expect(bars[0].style.height).toBe(`${(86 / 250) * 150}px`);
    expect(bars[3].style.height).toBe(`${(220 / 250) * 150}px`);
    // A zero draws nothing.
    expect(bars[2].style.height).toBe("0px");
  });

  it("writes every day under the axis the way Workiz does", () => {
    render(<WzWidgetBarChart title="Jobs by status" days={DAYS} series={series} />);
    const labels = [...document.querySelectorAll("[data-slot=wz-chart-xlabel]")].map((t) => t.textContent);
    expect(labels).toEqual(["Sep 24th", "Sep 25th", "Sep 26th"]);
  });

  it("names the bar under the pointer in a chart.js tooltip", () => {
    render(<WzWidgetBarChart title="Jobs by status" days={DAYS} series={series} />);
    fireEvent.mouseEnter(document.querySelectorAll("[data-slot=wz-chart-bar]")[0]);
    const tip = screen.getByRole("tooltip");
    expect(tip).toHaveTextContent("Sep 24th");
    expect(tip).toHaveTextContent("Canceled: 86");
    expect(tip).not.toHaveTextContent("Done");
  });

  it("reads a whole day out on keyboard focus", () => {
    render(<WzWidgetBarChart title="Sales" days={DAYS} series={series} format={(v) => `$${v}`} />);
    const day = screen.getByRole("button", { name: "Sep 25th: Canceled $0, Done $220" });
    fireEvent.focus(day);
    expect(screen.getByRole("tooltip")).toHaveTextContent("Done: $220");
  });

  it("carries the same numbers as a table for screen readers", () => {
    render(<WzWidgetBarChart title="Jobs by status" days={DAYS} series={series} />);
    const table = screen.getByRole("table", { name: "Jobs by status" });
    expect(within(table).getAllByRole("row")).toHaveLength(4);
    expect(within(table).getByRole("row", { name: "Sep 24th 86 38" })).toBeInTheDocument();
  });
});

/** Top Call Flows' curved lines. */
describe("WzWidgetLineChart", () => {
  const series = [
    { label: "SURE CT", color: "var(--wz-series1)", values: [10, 65, 30] },
    { label: "SURE TX", color: "var(--wz-series2)", values: [0, 5, 12] },
  ];

  it("draws a curve and a ring per day for each flow, on a 0..70 axis", () => {
    render(<WzWidgetLineChart title="Calls per call flow" days={DAYS} series={series} />);
    expect(document.querySelectorAll("[data-slot=wz-chart-line]")).toHaveLength(2);
    expect(document.querySelectorAll("[data-slot=wz-chart-point]")).toHaveLength(6);
    const ticks = [...document.querySelectorAll("[data-slot=wz-chart-ytick]")].map((t) => t.textContent);
    expect(ticks.at(-1)).toBe("70");
  });

  it("labels the days as 09/24/26", () => {
    render(<WzWidgetLineChart title="Calls per call flow" days={DAYS} series={series} />);
    const labels = [...document.querySelectorAll("[data-slot=wz-chart-xlabel]")].map((t) => t.textContent);
    expect(labels[0]).toBe("09/24/26");
  });

  it("tells a day's counts on hover", () => {
    render(<WzWidgetLineChart title="Calls per call flow" days={DAYS} series={series} />);
    fireEvent.mouseEnter(screen.getByRole("button", { name: "09/25/26: SURE CT 65, SURE TX 5" }));
    const tip = screen.getByRole("tooltip");
    expect(tip).toHaveTextContent("SURE CT: 65");
    expect(tip).toHaveTextContent("SURE TX: 5");
  });
});

/** Top Sources / Top Job Types / Service Areas. */
describe("WzWidgetPie", () => {
  const slices = [
    { key: "a", name: "SURE TX PLATINUM", count: 51, percent: 32.28 },
    { key: "b", name: "SURE CT GOOGLE ADS", count: 43, percent: 27.22 },
    { key: "c", name: "MOBILE CT LOCKSMITH LSA", count: 37, percent: 23.42 },
    { key: "d", name: "SURE CT NEW HAVEN LSA", count: 27, percent: 17.08 },
  ];

  it("draws a wedge a slice and Workiz's two-by-two legend of percents", () => {
    render(<WzWidgetPie title="Top Sources" slices={slices} />);
    expect(document.querySelectorAll("[data-slot=wz-pie-slice]")).toHaveLength(4);
    const legend = screen.getByRole("list", { name: "Legend" });
    const items = within(legend).getAllByRole("listitem");
    expect(items.map((i) => i.textContent)).toEqual([
      "SURE TX PLATINUM32.28%",
      "SURE CT GOOGLE ADS27.22%",
      "MOBILE CT LOCKSMITH LSA23.42%",
      "SURE CT NEW HAVEN LSA17.08%",
    ]);
    // The right column is ruled on its right and set flush right.
    expect(items[1].className).toContain("border-r-2");
    expect(items[0].className).toContain("border-l-2");
  });

  it("names a wedge and its count in a tooltip on hover", () => {
    render(<WzWidgetPie title="Top Sources" slices={slices} />);
    fireEvent.mouseEnter(document.querySelectorAll("[data-slot=wz-pie-slice]")[0]);
    expect(screen.getByRole("tooltip")).toHaveTextContent("SURE TX PLATINUM: 51");
  });

  it("says so when there is nothing to draw", () => {
    render(<WzWidgetPie title="Top Sources" slices={[]} />);
    expect(screen.getByText("No data to display")).toBeInTheDocument();
  });
});
