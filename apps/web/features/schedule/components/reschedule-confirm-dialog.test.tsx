import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { JobSuperStatus, type Deal } from "@bitcrm/types";
import { RescheduleConfirmDialog } from "./reschedule-confirm-dialog";

const deal: Deal = {
  id: "d1",
  dealNumber: "AB12CD",
  contactId: "c1",
  clientType: "residential" as Deal["clientType"],
  serviceArea: "North",
  address: { street: "1 Elm", city: "Town", state: "CT", zip: "06001" },
  jobTypeId: "jt",
  superStatus: JobSuperStatus.SUBMITTED,
  assignedTechIds: ["t1"],
  assignedDispatcherId: "u1",
  priority: "normal" as Deal["priority"],
  tagIds: [],
  status: "active" as Deal["status"],
  createdBy: "u1",
  createdAt: "",
  updatedAt: "",
  scheduledDate: "2026-10-09",
  scheduledTimeSlot: "09:00-11:00",
};

const users = new Map([
  ["t1", { id: "t1", firstName: "Sam", lastName: "Reyes" }],
  ["t2", { id: "t2", firstName: "Nia", lastName: "Holt" }],
]);

describe("RescheduleConfirmDialog — a drop asks before it saves", () => {
  it("names the old and new times", () => {
    render(
      <RescheduleConfirmDialog
        target={{ deal, body: { scheduledDate: "2026-10-10", scheduledTimeSlot: "10:00-12:00" }, scheduling: false }}
        users={users}
        conflicts={[]}
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(screen.getByRole("alertdialog", { name: "Reschedule job #AB12CD?" })).toBeInTheDocument();
    // Connecticut's clock, and it says so (2026-10-12 owner rule).
    expect(screen.getByText(/Oct 9, 09:00 AM - 11:00 AM EDT →/)).toBeInTheDocument();
    expect(screen.getByText("Oct 10, 10:00 AM - 12:00 PM EDT")).toBeInTheDocument();
    // A Connecticut job has no other clock to show.
    expect(screen.queryByText(/local time/)).not.toBeInTheDocument();
  });

  it("shows a Texas job on Connecticut's clock, with the job's own time under it", () => {
    render(
      <RescheduleConfirmDialog
        target={{
          deal: { ...deal, scheduledDate: "2026-10-12", scheduledTimeSlot: "10:00-12:00" },
          body: { scheduledDate: "2026-10-12", scheduledTimeSlot: "11:00-13:00" },
          scheduling: false,
          zone: "America/Chicago",
        }}
        users={users}
        conflicts={[]}
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(screen.getByText(/Oct 12, 11:00 AM - 01:00 PM EDT →/)).toBeInTheDocument();
    expect(screen.getByText("Oct 12, 12:00 PM - 02:00 PM EDT")).toBeInTheDocument();
    expect(screen.getByText("Job's local time: Oct 12, 11:00 AM - 01:00 PM CDT")).toBeInTheDocument();
  });

  it("names the technicians when a Timeline drop moves the job to another row", () => {
    render(
      <RescheduleConfirmDialog
        target={{ deal, body: { scheduledDate: "2026-10-09", scheduledTimeSlot: "09:00-11:00" }, fromTechId: "t1", toTechId: "t2", scheduling: false }}
        users={users}
        conflicts={[]}
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(screen.getByText("Nia Holt")).toBeInTheDocument();
    expect(screen.getByText(/Sam Reyes →/)).toBeInTheDocument();
  });

  it("schedules an unscheduled job, warning of a clash, and confirms", async () => {
    const onConfirm = vi.fn();
    render(
      <RescheduleConfirmDialog
        target={{
          deal: { ...deal, scheduledDate: undefined, scheduledTimeSlot: undefined },
          body: { scheduledDate: "2026-10-09", scheduledTimeSlot: "14:30-15:30" },
          scheduling: true,
        }}
        users={users}
        conflicts={["double_booked"]}
        onConfirm={onConfirm}
        onCancel={() => {}}
      />,
    );
    expect(screen.getByRole("alertdialog", { name: "Schedule job #AB12CD?" })).toBeInTheDocument();
    expect(screen.getByText(/unscheduled →/)).toBeInTheDocument();
    expect(screen.getByText(/overlaps another job/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Schedule" }));
    expect(onConfirm).toHaveBeenCalled();
  });
});
