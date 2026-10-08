import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import {
  ScheduledBlock,
  slotTimes,
  withAllDay,
  withEndTime,
  withScheduled,
  withStartTime,
} from "./scheduled-block";

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

  it("has no recurring-schedule control", () => {
    render(<ScheduledBlock {...base} onChange={vi.fn()} />);
    expect(screen.queryByText(/recurring/i)).not.toBeInTheDocument();
  });
});

/**
 * The rules behind the block, shared with the Workiz schedule block
 * (workiz/schedule-block.tsx) so both forms schedule a job the same way.
 */
describe("schedule value rules", () => {
  const v = { date: "2026-08-19", endDate: "", slot: "08:00-09:00", allDay: false };

  it("reads the start and end times out of the slot", () => {
    expect(slotTimes("08:00-09:30")).toEqual(["08:00", "09:30"]);
    expect(slotTimes("")).toEqual(["", ""]);
  });

  it("a new start keeps the end; a start with no end yet ends when it starts", () => {
    expect(withStartTime(v, "10:00").slot).toBe("10:00-09:00");
    expect(withStartTime({ ...v, slot: "" }, "10:00").slot).toBe("10:00-10:00");
    expect(withStartTime(v, "").slot).toBe("");
  });

  it("a new end needs a start; without one the slot is left alone", () => {
    expect(withEndTime(v, "11:00").slot).toBe("08:00-11:00");
    expect(withEndTime({ ...v, slot: "" }, "11:00").slot).toBe("");
  });

  it("all-day drops the times", () => {
    expect(withAllDay(v, true)).toEqual({ ...v, allDay: true, slot: "" });
    expect(withAllDay({ ...v, allDay: true, slot: "" }, false)).toEqual({ ...v, allDay: false, slot: "" });
  });

  it("switching Scheduled off clears the schedule; on again starts from now in the job's zone", () => {
    expect(withScheduled(v, false, "America/Chicago")).toEqual({ date: "", endDate: "", slot: "", allDay: false });
    // 13:53 UTC = 8:53 AM Chicago → up to 09:00, an hour long.
    expect(withScheduled({ date: "", endDate: "", slot: "", allDay: false }, true, "America/Chicago", new Date("2026-10-08T13:53:00Z"))).toEqual({
      date: "2026-10-08",
      endDate: "2026-10-08",
      slot: "09:00-10:00",
      allDay: false,
    });
    // Already scheduled: on is a no-op.
    expect(withScheduled(v, true, "America/Chicago")).toBe(v);
  });
});
