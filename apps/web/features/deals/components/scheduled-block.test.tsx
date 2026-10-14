import { describe, it, expect, vi } from "vitest";
import { useState } from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import {
  ScheduledBlock,
  slotTimes,
  withAllDay,
  withEndTime,
  withScheduled,
  withDuration,
  withStartDate,
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

  it("editing the start time moves the end with it — the visit keeps its length", () => {
    const onChange = vi.fn();
    render(<ScheduledBlock {...base} onChange={onChange} />);

    fireEvent.change(screen.getByLabelText("Start time"), { target: { value: "10:00" } });
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ slot: "10:00-11:00", endDate: "2026-08-19" }),
    );
  });

  it("editing the start date moves the end date with it", () => {
    const onChange = vi.fn();
    render(<ScheduledBlock {...base} onChange={onChange} />);

    fireEvent.change(screen.getByLabelText("Start date"), { target: { value: "2026-08-20" } });
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ date: "2026-08-20", endDate: "2026-08-20", slot: "08:00-09:00" }),
    );
  });

  it("once the end was set by hand, a moved start keeps it — unless it would fall before the start", () => {
    function Harness() {
      const [v, setV] = useState({ date: base.date, endDate: base.endDate, slot: base.slot, allDay: false });
      return (
        <>
          <ScheduledBlock {...v} onChange={setV} />
          <output data-testid="value">{v.slot}</output>
        </>
      );
    }
    render(<Harness />);

    fireEvent.change(screen.getByLabelText("End time"), { target: { value: "12:00" } });
    expect(screen.getByTestId("value")).toHaveTextContent("08:00-12:00");
    fireEvent.change(screen.getByLabelText("Start time"), { target: { value: "10:00" } });
    expect(screen.getByTestId("value")).toHaveTextContent("10:00-12:00");
    fireEvent.change(screen.getByLabelText("Start time"), { target: { value: "14:00" } });
    expect(screen.getByTestId("value")).toHaveTextContent("14:00-14:00");
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

  /**
   * Workiz: moving Starts carries Ends with it — the visit keeps its length.
   * QA 2026-10-14 #11: ours left Ends where it was, so a start moved past it
   * made a job that ended before it began.
   */
  it("a new start time moves the end the same way: the visit keeps its length", () => {
    expect(withStartTime(v, "10:00")).toMatchObject({ slot: "10:00-11:00", endDate: "2026-08-19" });
    expect(withStartTime({ ...v, slot: "10:00-12:00" }, "14:00").slot).toBe("14:00-16:00");
    expect(withStartTime({ ...v, slot: "10:00-12:00" }, "09:00").slot).toBe("09:00-11:00");
  });

  it("a visit moved past midnight ends on the next day, as a job type's duration would put it", () => {
    expect(withStartTime({ ...v, slot: "22:00-23:30" }, "23:00")).toMatchObject({ slot: "23:00-00:30", endDate: "2026-08-20" });
    expect(withStartTime({ ...v, endDate: "2026-08-20", slot: "23:00-00:30" }, "08:00")).toMatchObject({
      slot: "08:00-09:30",
      endDate: "2026-08-19",
    });
  });

  it("a new start date moves the end date the same way, keeping the time span", () => {
    expect(withStartDate(v, "2026-08-20")).toEqual({ ...v, date: "2026-08-20", endDate: "2026-08-20" });
    expect(withStartDate({ ...v, endDate: "2026-08-21" }, "2026-08-25")).toMatchObject({ date: "2026-08-25", endDate: "2026-08-27" });
    const allDay = { date: "2026-08-19", endDate: "2026-08-20", slot: "", allDay: true };
    expect(withStartDate(allDay, "2026-09-01")).toEqual({ ...allDay, date: "2026-09-01", endDate: "2026-09-02" });
  });

  it("a start with no end yet ends when it starts; clearing the start time clears the times", () => {
    expect(withStartTime({ ...v, slot: "" }, "10:00").slot).toBe("10:00-10:00");
    expect(withStartTime(v, "").slot).toBe("");
    expect(withStartTime({ ...v, date: "" }, "10:00")).toMatchObject({ date: "", slot: "10:00-09:00" });
  });

  it("an end already before its start is not carried along: the moved visit ends when it starts", () => {
    expect(withStartTime({ ...v, slot: "10:00-08:53" }, "12:00").slot).toBe("12:00-12:00");
  });

  it("once the end was set by hand, a moved start keeps it — and only drags it up to itself", () => {
    const hand = { ...v, slot: "10:00-12:00" };
    expect(withStartTime(hand, "11:00", { endEdited: true }).slot).toBe("11:00-12:00");
    expect(withStartTime(hand, "14:00", { endEdited: true }).slot).toBe("14:00-14:00");
    expect(withStartDate(hand, "2026-08-20", { endEdited: true })).toMatchObject({ date: "2026-08-20", endDate: "2026-08-20", slot: "10:00-10:00" });
    expect(withStartDate({ ...hand, endDate: "2026-08-21" }, "2026-08-20", { endEdited: true })).toMatchObject({
      date: "2026-08-20",
      endDate: "2026-08-21",
      slot: "10:00-12:00",
    });
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

  /**
   * Workiz's job type carries a Duration: picking the type ends the visit
   * that long after its start (2 h → 08:00–10:00). A long one runs into the
   * next days (50 h), an all-day or unscheduled visit has no times to move.
   */
  it("a job type's duration sets the end that long after the start", () => {
    expect(withDuration(v, 120)).toEqual({ ...v, endDate: "2026-08-19", slot: "08:00-10:00" });
    expect(withDuration(v, 90)).toEqual({ ...v, endDate: "2026-08-19", slot: "08:00-09:30" });
    expect(withDuration({ ...v, slot: "23:30-23:45" }, 60)).toEqual({ ...v, endDate: "2026-08-20", slot: "23:30-00:30" });
    expect(withDuration(v, 3000)).toEqual({ ...v, endDate: "2026-08-21", slot: "08:00-10:00" });
  });

  it("…and leaves an all-day, unscheduled or timeless visit alone", () => {
    const allDay = { ...v, allDay: true, slot: "" };
    expect(withDuration(allDay, 120)).toBe(allDay);
    const off = { date: "", endDate: "", slot: "", allDay: false };
    expect(withDuration(off, 120)).toBe(off);
    const noTimes = { ...v, slot: "" };
    expect(withDuration(noTimes, 120)).toBe(noTimes);
  });
});
