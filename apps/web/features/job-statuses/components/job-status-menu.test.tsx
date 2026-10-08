import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { JobSuperStatus } from "@bitcrm/types";

vi.mock("../hooks", () => ({
  useJobStatuses: () => ({
    data: [{ id: "s-ip", name: "In progress", group: JobSuperStatus.IN_PROGRESS, color: "purple", priority: 0, active: true }],
  }),
}));

import { JobStatusMenu } from "./job-status-menu";

const u = () => userEvent.setup({ pointerEventsCheck: 0 });

describe("JobStatusMenu — Workiz's status picker (job_b_02_status_open)", () => {
  // J11: "In Progress" over "In progress" read as one word twice, and both picked.
  it("greys out a super-status that has sub-statuses: its sub-status is the choice", async () => {
    const onChange = vi.fn();
    render(<JobStatusMenu value={{ superStatus: JobSuperStatus.SUBMITTED }} onChange={onChange} />);

    await u().click(screen.getByRole("combobox", { name: /job status/i }));
    const heading = screen.getByRole("option", { name: "In Progress" });
    expect(heading).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByRole("option", { name: "Done" })).not.toHaveAttribute("aria-disabled");

    await u().click(heading);
    expect(onChange).not.toHaveBeenCalled();
    await u().click(screen.getByRole("option", { name: "In progress" }));
    expect(onChange).toHaveBeenCalledWith({ superStatus: JobSuperStatus.IN_PROGRESS, subStatusId: "s-ip" });
  });
});
