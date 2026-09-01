import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { DateTimeRangePicker } from "./date-time-range-picker";

describe("DateTimeRangePicker presets", () => {
  const open = () => {
    fireEvent.click(screen.getByRole("button", { name: "Days" }));
  };

  it("offers the full preset list by default", () => {
    render(
      <DateTimeRangePicker dateOnly label="Days" value={{}} onChange={vi.fn()} />,
    );
    open();

    for (const label of [
      "All time",
      "Today",
      "Yesterday",
      "Last 7 days",
      "Last 30 days",
      "This month",
      "Last month",
      "This year",
    ]) {
      expect(screen.getByRole("button", { name: label })).toBeInTheDocument();
    }
  });

  it("shows only the presets a page asks for", () => {
    render(
      <DateTimeRangePicker
        dateOnly
        label="Days"
        value={{}}
        onChange={vi.fn()}
        presets={["today"]}
      />,
    );
    open();

    expect(screen.getByRole("button", { name: "All time" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Today" })).toBeInTheDocument();
    for (const label of [
      "Yesterday",
      "Last 7 days",
      "Last 30 days",
      "This month",
      "Last month",
      "This year",
    ]) {
      expect(screen.queryByRole("button", { name: label })).not.toBeInTheDocument();
    }
  });
});
