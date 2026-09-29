import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithClient } from "@/test/render-with-client";
import { DailyChart } from "./daily-chart";
import { LineChart } from "./line-chart";
import { SharePie } from "./share-pie";

/**
 * Таблиця для скрінрідерів не має розпирати сторінку.
 *
 * `sr-only` стискає елемент до 1px, але таблиця не стискається нижче свого
 * вмісту: вісім колонок із назвами call flow розтягували дашборд до 2104px, і
 * сторінка скролилася вбік. Тож ховається обгортка, а не сама таблиця.
 */
describe("screen-reader tables are clipped by a wrapper, never by themselves", () => {
  it.each([
    [
      "LineChart",
      <LineChart
        key="l"
        title="Calls per call flow"
        days={["2026-09-14"]}
        series={[{ name: "A very long call flow name", values: [1] }]}
        labelOf={(d) => d}
      />,
      "Calls per call flow",
    ],
    [
      "SharePie",
      <SharePie key="p" title="Top Sources" slices={[{ key: "a", name: "A", count: 1, percent: 100 }]} />,
      "Top Sources",
    ],
    [
      "DailyChart",
      <DailyChart
        key="d"
        title="Jobs by status"
        days={[{ date: "2026-09-14", values: [1] }]}
        series={[{ label: "Done", className: "bg-chart-good" }]}
        format={String}
      />,
      "Jobs by status",
    ],
  ])("%s", (_, chart, name) => {
    renderWithClient(chart);
    const table = screen.getByRole("table", { name });
    expect(table.className).not.toContain("sr-only");
    expect(table.parentElement?.className).toContain("sr-only");
  });
});
