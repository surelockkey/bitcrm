import { useState } from "react";
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Controller, useForm } from "react-hook-form";
import { describe, expect, it, vi } from "vitest";

import {
  WzDateField,
  WzTimeSelect,
  formatWzDate,
  formatWzTime,
  parseWzDate,
  wzTimeSlots,
} from "./outlined";

describe("time and date text, as Workiz writes them", () => {
  it("writes times as zero-padded 12-hour clock", () => {
    expect(formatWzTime("15:30")).toBe("03:30 PM");
    expect(formatWzTime("08:00")).toBe("08:00 AM");
    expect(formatWzTime("00:15")).toBe("12:15 AM");
    expect(formatWzTime("12:00")).toBe("12:00 PM");
    expect(formatWzTime("")).toBe("");
  });

  it("offers the day in 15-minute slots", () => {
    const slots = wzTimeSlots();
    expect(slots).toHaveLength(96);
    expect(slots[0]).toEqual({ value: "00:00", label: "12:00 AM" });
    expect(slots[63]).toEqual({ value: "15:45", label: "03:45 PM" });
    expect(wzTimeSlots(30)).toHaveLength(48);
  });

  it("writes dates as 'Oct 08, 2026'", () => {
    expect(formatWzDate("2026-10-08")).toBe("Oct 08, 2026");
    expect(formatWzDate("")).toBe("");
    expect(formatWzDate("nope")).toBe("");
  });

  it("reads back what a person types", () => {
    expect(parseWzDate("Oct 08, 2026")).toBe("2026-10-08");
    expect(parseWzDate("oct 8 2026")).toBe("2026-10-08");
    expect(parseWzDate("10/08/2026")).toBe("2026-10-08");
    expect(parseWzDate("2026-10-08")).toBe("2026-10-08");
    expect(parseWzDate("Feb 30, 2026")).toBeNull();
    expect(parseWzDate("tomorrow")).toBeNull();
  });
});

describe("the notched outline (Starts / Ends / At)", () => {
  it("names the field with a real <label> that sits in the top edge once there is a value", () => {
    render(<WzTimeSelect label="At" value="15:30" onChange={() => {}} />);
    const input = screen.getByRole("combobox", { name: "At" });
    const label = screen.getByText("At");
    expect(label.tagName).toBe("LABEL");
    expect(label).toHaveAttribute("for", input.id);
    expect(label).toHaveAttribute("data-floated", "true");
    // The legend: 11px ink on white, 8px in and 8px above the edge.
    expect(label.className).toContain("-top-2");
    expect(label.className).toContain("bg-white");
  });

  it("rests the label inside the box while empty and unfocused", () => {
    render(<WzTimeSelect label="At" value="" onChange={() => {}} />);
    expect(screen.getByText("At")).toHaveAttribute("data-floated", "false");
    act(() => screen.getByRole("combobox", { name: "At" }).focus());
    expect(screen.getByText("At")).toHaveAttribute("data-floated", "true");
  });
});

describe("WzTimeSelect", () => {
  const at = () => screen.getByRole("combobox", { name: "At" });
  const control = () =>
    at().closest("[data-slot=wz-time]")!.querySelector("[data-slot=wz-time-control]") as HTMLElement;

  it("shows the chosen time", () => {
    render(<WzTimeSelect label="At" value="15:30" onChange={() => {}} />);
    expect(screen.getByText("03:30 PM")).toBeInTheDocument();
  });

  it("leaves the chosen time out of the list, like Workiz", async () => {
    render(<WzTimeSelect label="At" value="15:30" onChange={() => {}} />);
    await userEvent.click(control());
    const options = within(screen.getByRole("listbox")).getAllByRole("option");
    expect(options).toHaveLength(95);
    expect(options.map((o) => o.textContent)).not.toContain("03:30 PM");
  });

  it("picks a time from the list", async () => {
    const onChange = vi.fn();
    render(<WzTimeSelect label="At" value="15:30" onChange={onChange} />);
    await userEvent.click(control());
    await userEvent.click(screen.getByRole("option", { name: "04:15 PM" }));
    expect(onChange).toHaveBeenCalledWith("16:15");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("filters as you type and picks with Enter", async () => {
    const onChange = vi.fn();
    render(<WzTimeSelect label="At" value="15:30" onChange={onChange} />);
    act(() => at().focus());
    await userEvent.keyboard("4:45");
    expect(within(screen.getByRole("listbox")).getAllByRole("option").map((o) => o.textContent)).toEqual([
      "04:45 AM",
      "04:45 PM",
    ]);
    await userEvent.keyboard("{ArrowDown}{Enter}");
    expect(onChange).toHaveBeenCalledWith("16:45");
  });

  it("marks the box open for the blue edge and the flipped chevron", async () => {
    render(<WzTimeSelect label="At" value="15:30" onChange={() => {}} />);
    const root = at().closest("[data-slot=wz-time]") as HTMLElement;
    expect(root).toHaveAttribute("data-open", "false");
    await userEvent.click(control());
    expect(root).toHaveAttribute("data-open", "true");
  });

  it("can be disabled", async () => {
    render(<WzTimeSelect label="At" value="15:30" onChange={() => {}} disabled />);
    expect(at()).toBeDisabled();
    await userEvent.click(control());
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("drops into a react-hook-form Controller", async () => {
    const onSubmit = vi.fn();
    function Form() {
      const form = useForm<{ start: string }>({ defaultValues: { start: "08:00" } });
      return (
        <form onSubmit={form.handleSubmit((v) => onSubmit(v))}>
          <Controller
            name="start"
            control={form.control}
            render={({ field }) => <WzTimeSelect label="At" {...field} />}
          />
          <button type="submit">Save</button>
        </form>
      );
    }
    render(<Form />);
    expect(screen.getByText("08:00 AM")).toBeInTheDocument();
    await userEvent.click(control());
    await userEvent.click(screen.getByRole("option", { name: "09:00 AM" }));
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onSubmit).toHaveBeenCalledWith({ start: "09:00" });
  });
});

describe("WzDateField", () => {
  const starts = () => screen.getByRole("textbox", { name: "Starts" });

  it("shows the date the Workiz way under a notched label", () => {
    render(<WzDateField label="Starts" value="2026-10-08" onChange={() => {}} />);
    expect(starts()).toHaveValue("Oct 08, 2026");
    expect(screen.getByText("Starts")).toHaveAttribute("data-floated", "true");
  });

  it("opens a month calendar from its button and picks a day", async () => {
    const onChange = vi.fn();
    render(<WzDateField label="Starts" value="2026-10-08" onChange={onChange} />);
    await userEvent.click(screen.getByRole("button", { name: "Choose date, selected date is Oct 8, 2026" }));
    const grid = screen.getByRole("grid");
    expect(screen.getByText("October 2026")).toBeInTheDocument();
    expect(within(grid).getByRole("gridcell", { name: "8" })).toHaveAttribute("aria-selected", "true");
    await userEvent.click(within(grid).getByRole("gridcell", { name: "15" }));
    expect(onChange).toHaveBeenCalledWith("2026-10-15");
    expect(screen.queryByRole("grid")).not.toBeInTheDocument();
  });

  it("pages months", async () => {
    render(<WzDateField label="Starts" value="2026-10-08" onChange={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: /Choose date/ }));
    await userEvent.click(screen.getByRole("button", { name: "Next month" }));
    expect(screen.getByText("November 2026")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Previous month" }));
    await userEvent.click(screen.getByRole("button", { name: "Previous month" }));
    expect(screen.getByText("September 2026")).toBeInTheDocument();
  });

  it("switches to a year list and back", async () => {
    const onChange = vi.fn();
    render(<WzDateField label="Starts" value="2026-10-08" onChange={onChange} />);
    await userEvent.click(screen.getByRole("button", { name: /Choose date/ }));
    await userEvent.click(screen.getByRole("button", { name: "calendar view is open, switch to year view" }));
    await userEvent.click(screen.getByRole("radio", { name: "2027" }));
    expect(screen.getByText("October 2027")).toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("accepts a typed date on blur and puts back nonsense", async () => {
    const onChange = vi.fn();
    function C() {
      const [v, setV] = useState("2026-10-08");
      return (
        <WzDateField
          label="Starts"
          value={v}
          onChange={(next) => {
            onChange(next);
            setV(next);
          }}
        />
      );
    }
    render(<C />);
    await userEvent.clear(starts());
    await userEvent.type(starts(), "Nov 3, 2026");
    act(() => starts().blur());
    expect(onChange).toHaveBeenCalledWith("2026-11-03");
    expect(starts()).toHaveValue("Nov 03, 2026");
    await userEvent.clear(starts());
    await userEvent.type(starts(), "soon");
    act(() => starts().blur());
    expect(starts()).toHaveValue("Nov 03, 2026");
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("will not offer days before `min`", async () => {
    render(<WzDateField label="Ends" value="2026-10-08" min="2026-10-05" onChange={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: /Choose date/ }));
    expect(screen.getByRole("gridcell", { name: "4" })).toBeDisabled();
    expect(screen.getByRole("gridcell", { name: "5" })).toBeEnabled();
  });

  it("can be disabled", () => {
    render(<WzDateField label="Starts" value="2026-10-08" onChange={() => {}} disabled />);
    expect(starts()).toBeDisabled();
    expect(screen.getByRole("button", { name: /Choose date/ })).toBeDisabled();
  });

  it("drops into a react-hook-form Controller", async () => {
    const onSubmit = vi.fn();
    function Form() {
      const form = useForm<{ date: string }>({ defaultValues: { date: "2026-10-08" } });
      return (
        <form onSubmit={form.handleSubmit((v) => onSubmit(v))}>
          <Controller
            name="date"
            control={form.control}
            render={({ field }) => <WzDateField label="Starts" {...field} />}
          />
          <button type="submit">Save</button>
        </form>
      );
    }
    render(<Form />);
    await userEvent.click(screen.getByRole("button", { name: /Choose date/ }));
    await userEvent.click(screen.getByRole("gridcell", { name: "20" }));
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onSubmit).toHaveBeenCalledWith({ date: "2026-10-20" });
  });
});
