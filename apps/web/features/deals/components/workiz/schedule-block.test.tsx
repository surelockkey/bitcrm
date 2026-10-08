import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { WzScheduleBlock } from "./schedule-block";

const value = { date: "2026-10-08", endDate: "", slot: "08:00-09:00", allDay: false };

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
    expect(clock).toHaveTextContent(/^It's \d{1,2}:\d{2} (AM|PM) in Princeton$/);
    expect(within(clock).getByText(/\d{1,2}:\d{2} (AM|PM)/).tagName).toBe("B");
  });

  it("changing a time goes through the shared schedule rules", async () => {
    const onChange = vi.fn();
    render(<WzScheduleBlock layout="card" value={value} onChange={onChange} />);
    const [startAt] = screen.getAllByRole("combobox", { name: "At" });
    await userEvent.type(startAt, "10:00 AM");
    await userEvent.keyboard("{Enter}");
    expect(onChange).toHaveBeenCalledWith({ ...value, slot: "10:00-09:00" });
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
});
