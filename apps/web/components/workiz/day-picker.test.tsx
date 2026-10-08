import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { WzDayPicker, dayPickerWeeks } from "./day-picker";

/*
 * The calendar Workiz hangs under the report box's From: / To: inputs
 * (rep_jobs_wz_16c_custom_from_click): react-datepicker's stock month —
 * "October 2026", Su…Sa, the weeks the month touches, the chosen day blue,
 * today bold.
 */
describe("dayPickerWeeks", () => {
  it("lists the weeks a month touches, Sunday first, with the neighbours' days", () => {
    const weeks = dayPickerWeeks("2026-10");
    expect(weeks).toHaveLength(5);
    expect(weeks[0]).toEqual(["2026-09-27", "2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02", "2026-10-03"]);
    expect(weeks[4][6]).toBe("2026-10-31");
  });

  it("takes six weeks when the month needs them", () => {
    // August 2026 starts on a Saturday and runs to a Monday.
    expect(dayPickerWeeks("2026-08")).toHaveLength(6);
  });
});

describe("WzDayPicker", () => {
  it("shows the chosen day's month, the chosen day and today", () => {
    render(<WzDayPicker value="2026-10-05" today="2026-10-08" onSelect={() => {}} />);
    expect(screen.getByText("October 2026")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Choose Monday, October 5th, 2026" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Choose Thursday, October 8th, 2026" })).toHaveAttribute("aria-current", "date");
  });

  it("picks a day, and walks the months", async () => {
    const onSelect = vi.fn();
    render(<WzDayPicker value="2026-10-05" today="2026-10-08" onSelect={onSelect} />);
    await userEvent.click(screen.getByRole("button", { name: "Choose Wednesday, October 14th, 2026" }));
    expect(onSelect).toHaveBeenLastCalledWith("2026-10-14");
    await userEvent.click(screen.getByRole("button", { name: "Previous Month" }));
    expect(screen.getByText("September 2026")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Next Month" }));
    await userEvent.click(screen.getByRole("button", { name: "Next Month" }));
    const grid = screen.getByRole("grid", { name: "November 2026" });
    expect(within(grid).getByRole("button", { name: "Choose Sunday, November 1st, 2026" })).toBeInTheDocument();
  });
});
