import { describe, expect, it } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { DailyChart } from "./daily-chart";

const days = [
  { date: "2026-09-01", value: 160 },
  { date: "2026-09-02", value: 0 },
  { date: "2026-09-03", value: 40 },
];

describe("DailyChart", () => {
  it("draws one column per day, as tall as its share of the busiest day", () => {
    render(<DailyChart title="Revenue per day" days={days} format={(v) => `$${v}`} />);
    const bars = screen.getAllByTestId("daily-bar");
    expect(bars).toHaveLength(3);
    const h = bars.map((b) => Number(b.getAttribute("data-height")));
    expect(h[0]).toBeGreaterThan(h[2]);
    expect(h[2] / h[0]).toBeCloseTo(0.25, 2);
    expect(h[1]).toBe(0);
  });

  it("tells the day and its value on hover and on focus", () => {
    render(<DailyChart title="Revenue per day" days={days} format={(v) => `$${v}`} />);
    const targets = screen.getAllByTestId("daily-hit");
    fireEvent.mouseEnter(targets[2]);
    expect(screen.getByRole("tooltip")).toHaveTextContent("Sep 3");
    expect(screen.getByRole("tooltip")).toHaveTextContent("$40");
    fireEvent.mouseLeave(targets[2]);
    expect(screen.queryByRole("tooltip")).toBeNull();
    fireEvent.focus(targets[0]);
    expect(screen.getByRole("tooltip")).toHaveTextContent("$160");
  });

  it("keeps a table of the same numbers for screen readers", () => {
    render(<DailyChart title="Revenue per day" days={days} format={(v) => `$${v}`} />);
    const table = screen.getByRole("table", { name: "Revenue per day" });
    expect(within(table).getAllByRole("row")).toHaveLength(4);
    expect(within(table).getByText("$40")).toBeInTheDocument();
  });

  it("says so when the period is empty", () => {
    render(<DailyChart title="Revenue per day" days={[{ date: "2026-09-01", value: 0 }]} format={String} />);
    expect(screen.getByText("No data to display.")).toBeInTheDocument();
  });
});
