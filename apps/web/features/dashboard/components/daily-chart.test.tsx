import { describe, expect, it } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { DailyChart } from "./daily-chart";

const one = [
  { date: "2026-09-01", values: [160] },
  { date: "2026-09-02", values: [0] },
  { date: "2026-09-03", values: [40] },
];
const VALUE = [{ label: "Value", className: "bg-brand" }];

describe("DailyChart", () => {
  it("draws one column per day, as tall as its share of the busiest day", () => {
    render(<DailyChart title="Revenue per day" days={one} series={VALUE} format={(v) => `$${v}`} />);
    const bars = screen.getAllByTestId("daily-bar");
    expect(bars).toHaveLength(3);
    const h = bars.map((b) => Number(b.getAttribute("data-height")));
    expect(h[0]).toBeGreaterThan(h[2]);
    expect(h[2] / h[0]).toBeCloseTo(0.25, 2);
    expect(h[1]).toBe(0);
  });

  it("tells the day and its value on hover and on focus", () => {
    render(<DailyChart title="Revenue per day" days={one} series={VALUE} format={(v) => `$${v}`} />);
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
    render(<DailyChart title="Revenue per day" days={one} series={VALUE} format={(v) => `$${v}`} />);
    const table = screen.getByRole("table", { name: "Revenue per day" });
    expect(within(table).getAllByRole("row")).toHaveLength(4);
    expect(within(table).getByText("$40")).toBeInTheDocument();
  });

  it("says so when the period is empty", () => {
    render(
      <DailyChart
        title="Revenue per day"
        days={[{ date: "2026-09-01", values: [0] }]}
        series={VALUE}
        format={String}
      />,
    );
    expect(screen.getByText("No data to display.")).toBeInTheDocument();
  });

  // Одна серія називає себе заголовком; рамка легенди для неї — зайвий шум.
  it("shows no legend for a single series", () => {
    render(<DailyChart title="Revenue per day" days={one} series={VALUE} format={String} />);
    expect(screen.queryByRole("list", { name: "Legend" })).toBeNull();
  });
});

describe("DailyChart — a second series to compare", () => {
  const pair = [
    { date: "2026-09-01", values: [100, 40] },
    { date: "2026-09-02", values: [50, 10] },
  ];
  const SALES = [
    { label: "Sales", className: "bg-brand" },
    { label: "Profit", className: "bg-chart2" },
  ];

  it("puts both columns side by side on one scale, with a legend naming them", () => {
    render(<DailyChart title="Sales and profit" days={pair} format={(v) => `$${v}`} series={SALES} />);
    expect(screen.getAllByTestId("daily-bar")).toHaveLength(4);
    const legend = screen.getByRole("list", { name: "Legend" });
    expect(within(legend).getByText("Sales")).toBeInTheDocument();
    expect(within(legend).getByText("Profit")).toBeInTheDocument();
  });

  it("scales every series against the same top", () => {
    render(<DailyChart title="Sales and profit" days={pair} format={(v) => `$${v}`} series={SALES} />);
    const h = screen.getAllByTestId("daily-bar").map((b) => Number(b.getAttribute("data-height")));
    // top rounds 100 up to 100; profit 40 is 40% of it.
    expect(h[0]).toBeCloseTo(100, 2);
    expect(h[1]).toBeCloseTo(40, 2);
  });

  it("tells both values of the day", () => {
    render(<DailyChart title="Sales and profit" days={pair} format={(v) => `$${v}`} series={SALES} />);
    fireEvent.mouseEnter(screen.getAllByTestId("daily-hit")[0]);
    const tip = screen.getByRole("tooltip");
    expect(tip).toHaveTextContent("Sales $100");
    expect(tip).toHaveTextContent("Profit $40");
  });
});

/**
 * Три серії — «Jobs By Status» на дашборді. Нічого в геометрії не змінюється:
 * та сама шкала, той самий 2px рівчак, той самий заокруглений верх.
 */
describe("DailyChart — three series", () => {
  const trio = [
    { date: "2026-09-27", values: [28, 5, 15] },
    { date: "2026-09-28", values: [0, 287, 0] },
  ];
  const STATUS = [
    { label: "Canceled", className: "bg-chart-critical" },
    { label: "Open", className: "bg-chart-warning" },
    { label: "Done", className: "bg-chart-good" },
  ];

  it("draws a column per series per day", () => {
    render(<DailyChart title="Jobs by status" days={trio} series={STATUS} format={String} />);
    expect(screen.getAllByTestId("daily-bar")).toHaveLength(6);
  });

  it("names all three in the legend", () => {
    render(<DailyChart title="Jobs by status" days={trio} series={STATUS} format={String} />);
    const legend = screen.getByRole("list", { name: "Legend" });
    for (const s of STATUS) expect(within(legend).getByText(s.label)).toBeInTheDocument();
  });

  it("paints each series its own colour", () => {
    render(<DailyChart title="Jobs by status" days={trio} series={STATUS} format={String} />);
    const bars = screen.getAllByTestId("daily-bar");
    expect(bars[0].className).toContain("bg-chart-critical");
    expect(bars[1].className).toContain("bg-chart-warning");
    expect(bars[2].className).toContain("bg-chart-good");
  });

  it("tells every series of the day", () => {
    render(<DailyChart title="Jobs by status" days={trio} series={STATUS} format={String} />);
    fireEvent.mouseEnter(screen.getAllByTestId("daily-hit")[1]);
    const tip = screen.getByRole("tooltip");
    expect(tip).toHaveTextContent("Open 287");
    expect(tip).toHaveTextContent("Canceled 0");
  });

  it("keeps a column per series in the screen-reader table", () => {
    render(<DailyChart title="Jobs by status" days={trio} series={STATUS} format={String} />);
    const table = screen.getByRole("table", { name: "Jobs by status" });
    const header = within(table).getAllByRole("row")[0];
    expect(within(header).getAllByRole("columnheader")).toHaveLength(4);
  });
});
