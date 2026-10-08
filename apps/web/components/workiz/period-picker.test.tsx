import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { WzPeriodPicker, wzRangeText } from "./period-picker";

const PRESETS = [
  { id: "custom", label: "Custom" },
  { id: "today", label: "Today" },
  { id: "this_month", label: "This month" },
  { id: "last_month", label: "Last month" },
];

const setup = (over: Partial<Parameters<typeof WzPeriodPicker>[0]> = {}) => {
  const props = {
    presets: PRESETS,
    preset: "this_month",
    range: { from: "2026-10-01", to: "2026-10-08" },
    onPresetChange: vi.fn(),
    onCustomChange: vi.fn(),
    today: "2026-10-08",
    ...over,
  };
  render(<WzPeriodPicker {...props} />);
  return props;
};

describe("wzRangeText", () => {
  it("prints the days the way the legacy picker does", () => {
    expect(wzRangeText("2026-10-01", "2026-10-08")).toBe(
      "Oct 01 , 2026 - Oct 08 , 2026",
    );
    expect(wzRangeText("2026-10-08", "2026-10-08")).toBe("Oct 08 , 2026");
    expect(wzRangeText("2025-12-28", "2026-01-03")).toBe(
      "Dec 28 , 2025 - Jan 03 , 2026",
    );
  });
});

describe("WzPeriodPicker", () => {
  it("shows the period's name over its days on one button", () => {
    setup();
    const box = screen.getByRole("button", { name: /^Date range/ });
    expect(box).toHaveTextContent("This month");
    expect(box).toHaveTextContent("Oct 01 , 2026 - Oct 08 , 2026");
    expect(box).toHaveAttribute("aria-expanded", "false");
  });

  it("hangs the periods under it and picks one", async () => {
    const p = setup();
    await userEvent.click(screen.getByRole("button", { name: /^Date range/ }));
    const list = screen.getByRole("menu", { name: "Date range" });
    expect(
      within(list)
        .getAllByRole("menuitem")
        .map((i) => i.textContent),
    ).toEqual(["Custom", "Today", "This month", "Last month"]);
    await userEvent.click(screen.getByRole("menuitem", { name: "Last month" }));
    expect(p.onPresetChange).toHaveBeenCalledWith("last_month");
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("opens Custom's From and To, and applies once both days are picked on the calendar", async () => {
    const p = setup({ preset: "custom" });
    const from = screen.getByRole("textbox", { name: "From" });
    const to = screen.getByRole("textbox", { name: "To" });
    expect(from).toHaveAttribute("placeholder", "from");
    expect(to).toHaveAttribute("placeholder", "to");

    await userEvent.click(from);
    const cal = screen.getByRole("dialog", { name: "Choose a day" });
    expect(cal).toHaveTextContent("October 2026");
    await userEvent.click(
      within(cal).getByRole("button", { name: "Oct 3, 2026" }),
    );
    expect(from).toHaveValue("10/03/2026");
    expect(p.onCustomChange).not.toHaveBeenCalled();

    await userEvent.click(to);
    await userEvent.click(
      within(screen.getByRole("dialog", { name: "Choose a day" })).getByRole(
        "button",
        { name: "Oct 6, 2026" },
      ),
    );
    expect(p.onCustomChange).toHaveBeenCalledWith({
      from: "2026-10-03",
      to: "2026-10-06",
    });
  });

  it("walks the calendar a month at a time", async () => {
    setup({ preset: "custom" });
    await userEvent.click(screen.getByRole("textbox", { name: "From" }));
    await userEvent.click(
      screen.getByRole("button", { name: "Previous month" }),
    );
    expect(
      screen.getByRole("dialog", { name: "Choose a day" }),
    ).toHaveTextContent("September 2026");
  });

  it("swaps a From after the To so the period is never upside down", async () => {
    const p = setup({ preset: "custom" });
    await userEvent.click(screen.getByRole("textbox", { name: "From" }));
    await userEvent.click(screen.getByRole("button", { name: "Oct 7, 2026" }));
    await userEvent.click(screen.getByRole("textbox", { name: "To" }));
    await userEvent.click(screen.getByRole("button", { name: "Oct 2, 2026" }));
    expect(p.onCustomChange).toHaveBeenCalledWith({
      from: "2026-10-02",
      to: "2026-10-07",
    });
  });
});
