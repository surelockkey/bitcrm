import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ScheduledBlock } from "./scheduled-block";

const base = {
  date: "2026-08-19",
  endDate: "",
  slot: "08:00-09:00",
  allDay: false,
  tz: "America/New_York",
  areaName: "Sherman",
};

describe("ScheduledBlock", () => {
  it("shows Starts and Ends, each with a date and a time", () => {
    render(<ScheduledBlock {...base} onChange={vi.fn()} />);

    expect(screen.getByText("Starts")).toBeInTheDocument();
    expect(screen.getByText("Ends")).toBeInTheDocument();
    expect(screen.getByLabelText("Start date")).toHaveValue("2026-08-19");
    expect(screen.getByLabelText("End date")).toHaveValue("2026-08-19"); // defaults to start
    expect(screen.getByLabelText("Start time")).toBeInTheDocument();
    expect(screen.getByLabelText("End time")).toBeInTheDocument();
  });

  it("shows a live area clock", () => {
    render(<ScheduledBlock {...base} onChange={vi.fn()} />);
    expect(screen.getByText(/in Sherman/)).toBeInTheDocument();
  });

  it("all-day removes the times and reports allDay with no slot", () => {
    const onChange = vi.fn();
    render(<ScheduledBlock {...base} onChange={onChange} />);

    fireEvent.click(screen.getByLabelText(/all-day event/i));

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ allDay: true, slot: "" }),
    );
  });

  it("hides the time fields when all-day is on", () => {
    render(<ScheduledBlock {...base} allDay onChange={vi.fn()} />);
    expect(screen.queryByLabelText("Start time")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("End time")).not.toBeInTheDocument();
  });

  it("editing the start time keeps the end and reports the slot", () => {
    const onChange = vi.fn();
    render(<ScheduledBlock {...base} onChange={onChange} />);

    fireEvent.change(screen.getByLabelText("Start time"), { target: { value: "10:00" } });
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ slot: "10:00-09:00" }),
    );
  });

  it("editing the end date reports it", () => {
    const onChange = vi.fn();
    render(<ScheduledBlock {...base} onChange={onChange} />);

    fireEvent.change(screen.getByLabelText("End date"), { target: { value: "2026-08-20" } });
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ endDate: "2026-08-20" }),
    );
  });

  it("offers a recurring-schedule affordance", () => {
    render(<ScheduledBlock {...base} onChange={vi.fn()} />);
    expect(screen.getByText(/set recurring schedule/i)).toBeInTheDocument();
  });
});
