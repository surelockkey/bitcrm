import { useState } from "react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { ScheduledValue } from "../scheduled-block";
import { WzScheduleBlock } from "./schedule-block";

const value = { date: "2026-10-08", endDate: "", slot: "08:00-09:00", allDay: false };

/** The block as the New Job form holds it: controlled, every change written back. */
function Harness({ initial }: { initial: ScheduledValue }) {
  const [v, setV] = useState(initial);
  return (
    <>
      <WzScheduleBlock layout="card" value={v} onChange={setV} />
      <output data-testid="value">{`${v.date} ${v.endDate} ${v.slot}`}</output>
    </>
  );
}
const held = () => screen.getByTestId("value").textContent;
const pickTime = async (which: 0 | 1, label: string) => {
  const at = screen.getAllByRole("combobox", { name: "At" })[which];
  await userEvent.clear(at);
  await userEvent.type(at, label);
  await userEvent.keyboard("{Enter}");
};
const typeDate = async (name: "Starts" | "Ends", text: string) => {
  const box = screen.getByRole("textbox", { name });
  await userEvent.clear(box);
  await userEvent.type(box, `${text}{Enter}`);
};

describe("WzScheduleBlock — card (New Job 'Scheduled')", () => {
  it("is a 'Scheduled' card with the switch on, Starts/At and Ends/At filled in", () => {
    render(<WzScheduleBlock layout="card" value={value} onChange={vi.fn()} />);
    const card = screen.getByRole("region", { name: /Scheduled/ });
    expect(within(card).getByRole("switch", { name: "Scheduled" })).toBeChecked();
    expect(within(card).getByRole("textbox", { name: "Starts" })).toHaveValue("Oct 08, 2026");
    // The end date follows the start until it is set.
    expect(within(card).getByRole("textbox", { name: "Ends" })).toHaveValue("Oct 08, 2026");
    const times = within(card).getAllByRole("combobox", { name: "At" });
    expect(times).toHaveLength(2);
    expect(card).toHaveTextContent("08:00 AM");
    expect(card).toHaveTextContent("09:00 AM");
    expect(within(card).getByRole("checkbox", { name: "All-day event" })).not.toBeChecked();
  });

  it("shows Workiz's clock next to the title once it knows where the job is", () => {
    const { rerender } = render(<WzScheduleBlock layout="card" value={value} onChange={vi.fn()} />);
    expect(screen.queryByText(/It's/)).not.toBeInTheDocument();
    rerender(<WzScheduleBlock layout="card" value={value} onChange={vi.fn()} tz="America/Chicago" place="Princeton" />);
    const clock = screen.getByTestId("wz-time-notice");
    expect(clock).toHaveTextContent(/^It's \d{1,2}:\d{2} (AM|PM) C[DS]T in Princeton$/);
    expect(within(clock).getByText(/\d{1,2}:\d{2} (AM|PM)/).tagName).toBe("B");
  });

  /** 2026-10-12 owner rule: a clock always names its zone — "It's 7:53 AM CDT in Princeton". */
  it("names the zone of the job's clock", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date("2026-10-08T12:53:00.000Z"));
      const { unmount } = render(
        <WzScheduleBlock layout="card" value={value} onChange={vi.fn()} tz="America/Chicago" place="Princeton" />,
      );
      expect(screen.getByTestId("wz-time-notice")).toHaveTextContent("It's 7:53 AM CDT in Princeton");
      unmount();
      vi.setSystemTime(new Date("2026-12-01T15:05:00.000Z"));
      render(<WzScheduleBlock layout="card" value={value} onChange={vi.fn()} place="Norwich" />);
      expect(screen.getByTestId("wz-time-notice")).toHaveTextContent("It's 10:05 AM EST in Norwich");
    } finally {
      vi.useRealTimers();
    }
  });

  it("changing a time goes through the shared schedule rules: the visit keeps its length", async () => {
    const onChange = vi.fn();
    render(<WzScheduleBlock layout="card" value={value} onChange={onChange} />);
    const [startAt] = screen.getAllByRole("combobox", { name: "At" });
    await userEvent.type(startAt, "10:00 AM");
    await userEvent.keyboard("{Enter}");
    expect(onChange).toHaveBeenCalledWith({ ...value, endDate: "2026-10-08", slot: "10:00-11:00" });
  });

  /**
   * Workiz: moving Starts carries Ends with it. QA 2026-10-14 #11 (flow 2.5):
   * Starts typed a day later left Ends on the old day — a job that ended
   * before it began unless the dispatcher noticed.
   */
  it("moving Starts carries Ends with it — a later time ends later, a later day ends a day later", async () => {
    render(<Harness initial={{ ...value, slot: "10:00-12:00" }} />);
    await pickTime(0, "02:00 PM");
    expect(held()).toBe("2026-10-08 2026-10-08 14:00-16:00");
    await typeDate("Starts", "Oct 15, 2026");
    expect(held()).toBe("2026-10-15 2026-10-15 14:00-16:00");
    expect(screen.getByRole("textbox", { name: "Ends" })).toHaveValue("Oct 15, 2026");
  });

  it("once Ends was set by hand it stays put when Starts moves — unless it would fall before the start", async () => {
    render(<Harness initial={{ ...value, slot: "10:00-11:00" }} />);
    await pickTime(1, "01:00 PM");
    expect(held()).toBe("2026-10-08 2026-10-08 10:00-13:00");
    await pickTime(0, "11:00 AM");
    expect(held()).toBe("2026-10-08 2026-10-08 11:00-13:00");
    await pickTime(0, "03:00 PM");
    expect(held()).toBe("2026-10-08 2026-10-08 15:00-15:00");
  });

  it("all-day drops the times", async () => {
    const onChange = vi.fn();
    const { rerender } = render(<WzScheduleBlock layout="card" value={value} onChange={onChange} />);
    await userEvent.click(screen.getByRole("checkbox", { name: "All-day event" }));
    expect(onChange).toHaveBeenCalledWith({ ...value, allDay: true, slot: "" });
    rerender(<WzScheduleBlock layout="card" value={{ ...value, allDay: true, slot: "" }} onChange={onChange} />);
    expect(screen.queryByRole("combobox", { name: "At" })).not.toBeInTheDocument();
  });

  it("switching it off unschedules the job and hides the dates, keeping the team below", async () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <WzScheduleBlock layout="card" value={value} onChange={onChange}>
        <div>team here</div>
      </WzScheduleBlock>,
    );
    await userEvent.click(screen.getByRole("switch", { name: "Scheduled" }));
    expect(onChange).toHaveBeenCalledWith({ date: "", endDate: "", slot: "", allDay: false });
    rerender(
      <WzScheduleBlock layout="card" value={{ date: "", endDate: "", slot: "", allDay: false }} onChange={onChange}>
        <div>team here</div>
      </WzScheduleBlock>,
    );
    expect(screen.getByRole("switch", { name: "Scheduled" })).not.toBeChecked();
    expect(screen.queryByRole("textbox", { name: "Starts" })).not.toBeInTheDocument();
    expect(screen.getByText("team here")).toBeInTheDocument();
  });

  it("has no recurring-schedule control (we have no recurring jobs)", () => {
    render(<WzScheduleBlock layout="card" value={value} onChange={vi.fn()} />);
    expect(screen.queryByText(/recurring/i)).not.toBeInTheDocument();
  });
});

describe("WzScheduleBlock — section (job page 'Schedule')", () => {
  it("is a 'Schedule' section with the switch in its header and View schedule beside All-day", () => {
    render(
      <WzScheduleBlock layout="section" value={value} onChange={vi.fn()} viewScheduleHref="/schedule" />,
    );
    const header = screen.getByRole("heading", { name: /Schedule/ });
    expect(within(header).getByRole("switch", { name: "Schedule" })).toBeChecked();
    expect(screen.getByRole("link", { name: "View schedule" })).toHaveAttribute("href", "/schedule");
  });

  it("is read-only when disabled", () => {
    render(<WzScheduleBlock layout="section" value={value} onChange={vi.fn()} disabled />);
    expect(screen.getByRole("switch", { name: "Schedule" })).toBeDisabled();
    expect(screen.getByRole("checkbox", { name: "All-day event" })).toBeDisabled();
  });

  /**
   * 2026-10-12: the inputs hold the visit as stored — on the clock of the zone
   * it was booked in — while every other time on the web is Connecticut's. A
   * job booked elsewhere says which clock its inputs are on.
   */
  it("says which zone the times are in when it is not Connecticut's", () => {
    const { rerender } = render(<WzScheduleBlock layout="section" value={value} onChange={vi.fn()} tz="America/Chicago" />);
    expect(screen.getByTestId("wz-zone-notice")).toHaveTextContent("Times in CDT");
    rerender(
      <WzScheduleBlock layout="section" value={{ ...value, date: "2026-12-01" }} onChange={vi.fn()} tz="America/Chicago" />,
    );
    expect(screen.getByTestId("wz-zone-notice")).toHaveTextContent("Times in CST");
    rerender(<WzScheduleBlock layout="section" value={value} onChange={vi.fn()} tz="America/New_York" />);
    expect(screen.queryByTestId("wz-zone-notice")).not.toBeInTheDocument();
    rerender(<WzScheduleBlock layout="section" value={value} onChange={vi.fn()} />);
    expect(screen.queryByTestId("wz-zone-notice")).not.toBeInTheDocument();
  });
});
