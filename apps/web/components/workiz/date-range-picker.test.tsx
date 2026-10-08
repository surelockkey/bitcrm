import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { WzDateRangePicker, type WzDateRange } from "./date-range-picker";

/**
 * Workiz's date box (`._picker`, callspage_wz_01 / _06_date_open /
 * _06_date_custom): the preset's name over "Oct 8th, 2026 - Oct 8th, 2026";
 * a click lists the presets under it; Custom opens From:/To: inputs inside.
 */
const presets = [
  { id: "custom", label: "Custom" },
  { id: "today", label: "Today" },
  { id: "yesterday", label: "Yesterday" },
];
const rangeOf = (id: string) =>
  id === "today" ? { from: "2026-10-08", to: "2026-10-08" } : id === "yesterday" ? { from: "2026-10-07", to: "2026-10-07" } : null;

const today: WzDateRange = { preset: "today", from: "2026-10-08", to: "2026-10-08" };

function setup(value: WzDateRange = today) {
  const onChange = vi.fn();
  render(<WzDateRangePicker presets={presets} rangeOf={rangeOf} value={value} onChange={onChange} />);
  return onChange;
}

describe("WzDateRangePicker", () => {
  it("names the preset over its days", () => {
    setup();
    const box = screen.getByRole("button", { name: /date range/i });
    expect(box).toHaveTextContent("Today");
    expect(box).toHaveTextContent("Oct 8th, 2026 - Oct 8th, 2026");
    expect(box).toHaveAttribute("aria-expanded", "false");
  });

  it("lists the presets on a click and takes the one picked", async () => {
    const onChange = setup();
    await userEvent.click(screen.getByRole("button", { name: /date range/i }));
    const list = screen.getByRole("listbox", { name: "Date presets" });
    expect(within(list).getAllByRole("option").map((o) => o.textContent)).toEqual(["Custom", "Today", "Yesterday"]);

    await userEvent.click(within(list).getByRole("option", { name: "Yesterday" }));
    expect(onChange).toHaveBeenCalledWith({ preset: "yesterday", from: "2026-10-07", to: "2026-10-07" });
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("closes the list on Escape", async () => {
    setup();
    await userEvent.click(screen.getByRole("button", { name: /date range/i }));
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("Custom keeps the days and opens From / To", async () => {
    const onChange = setup();
    await userEvent.click(screen.getByRole("button", { name: /date range/i }));
    await userEvent.click(screen.getByRole("option", { name: "Custom" }));
    expect(onChange).toHaveBeenCalledWith({ preset: "custom", from: "2026-10-08", to: "2026-10-08" });
  });

  it("reads typed days on blur, and pulls To along when From passes it", () => {
    const onChange = setup({ preset: "custom", from: "2026-10-01", to: "2026-10-05" });
    const from = screen.getByRole("textbox", { name: "From" });
    const to = screen.getByRole("textbox", { name: "To" });
    expect(from).toHaveValue("10/01/2026");
    expect(to).toHaveValue("10/05/2026");

    fireEvent.change(from, { target: { value: "10/09/2026" } });
    fireEvent.blur(from);
    expect(onChange).toHaveBeenLastCalledWith({ preset: "custom", from: "2026-10-09", to: "2026-10-09" });

    fireEvent.change(to, { target: { value: "10/07/2026" } });
    fireEvent.keyDown(to, { key: "Enter" });
    expect(onChange).toHaveBeenLastCalledWith({ preset: "custom", from: "2026-10-01", to: "2026-10-07" });
  });

  it("puts nonsense back instead of filtering by it", () => {
    const onChange = setup({ preset: "custom", from: "2026-10-01", to: "2026-10-05" });
    const from = screen.getByRole("textbox", { name: "From" });
    fireEvent.change(from, { target: { value: "13/45/2026" } });
    fireEvent.blur(from);
    expect(onChange).not.toHaveBeenCalled();
    expect(from).toHaveValue("10/01/2026");
  });

  it("has no calendar unless asked for one", async () => {
    setup({ preset: "custom", from: "2026-10-01", to: "2026-10-05" });
    await userEvent.click(screen.getByRole("textbox", { name: "From" }));
    expect(screen.queryByRole("grid")).not.toBeInTheDocument();
  });

  // The Jobs report's box (rep_jobs_wz_16c_custom_from_click): a click in
  // From: or To: hangs react-datepicker's month under it; a day picked there
  // is taken at once and the month folds away.
  it("with `calendar`, hangs a month under the focused end and takes the day picked", async () => {
    const onChange = vi.fn();
    render(
      <WzDateRangePicker
        presets={presets}
        rangeOf={rangeOf}
        value={{ preset: "custom", from: "2026-10-01", to: "2026-10-05" }}
        onChange={onChange}
        calendar={{ today: "2026-10-08" }}
      />,
    );
    await userEvent.click(screen.getByRole("textbox", { name: "To" }));
    const month = screen.getByRole("grid", { name: "October 2026" });
    expect(within(month).getByRole("button", { name: "Choose Monday, October 5th, 2026" })).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(within(month).getByRole("button", { name: "Choose Wednesday, October 7th, 2026" }));
    expect(onChange).toHaveBeenLastCalledWith({ preset: "custom", from: "2026-10-01", to: "2026-10-07" });
    expect(screen.queryByRole("grid")).not.toBeInTheDocument();
  });
});
