import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  ClientType,
  DealPriority,
  DealStatus,
  JobSuperStatus,
  type Deal,
} from "@bitcrm/types";
import { groupJobsByDay } from "../lib";
import { MyJobsPage } from "./my-jobs-page";

const can = vi.fn((resource: string) => resource === "deals");
vi.mock("@/features/auth/use-permissions", () => ({
  usePermissions: () => ({ can, isTechnician: true, isLoading: false }),
}));

const jobs = vi.fn();
vi.mock("../hooks", () => ({ useMyJobs: () => jobs() }));

// The card is covered by its own test; here it stands in for "a job is listed".
vi.mock("./tech-job-card", () => ({
  TechJobCard: ({ deal }: { deal: Deal }) => (
    <article data-testid="tech-job-card">#{deal.dealNumber}</article>
  ),
}));
vi.mock("./team-chat-badge", () => ({ TeamChatBadge: () => <span data-testid="team-chat-badge" /> }));
vi.mock("./install-hint", () => ({ InstallHint: () => null }));

const TODAY = "2026-09-16";

function deal(over: Partial<Deal> = {}): Deal {
  return {
    id: over.id ?? "d1",
    dealNumber: over.dealNumber ?? "A1B2C3",
    contactId: "c1",
    clientType: ClientType.RESIDENTIAL,
    serviceArea: "CT",
    address: { street: "1 Main St", city: "Hartford", state: "CT", zip: "06103" },
    jobTypeId: "jt1",
    superStatus: JobSuperStatus.IN_PROGRESS,
    assignedTechIds: ["t1"],
    assignedDispatcherId: "u1",
    priority: DealPriority.NORMAL,
    tagIds: [],
    status: DealStatus.ACTIVE,
    createdBy: "u1",
    createdAt: "",
    updatedAt: "",
    ...over,
  };
}

function state(over: Record<string, unknown> = {}) {
  return {
    groups: [],
    techId: "t1",
    ready: true,
    isLoading: false,
    isError: false,
    isRefetching: false,
    refetch: vi.fn().mockResolvedValue(undefined),
    ...over,
  };
}

describe("MyJobsPage", () => {
  beforeEach(() => {
    can.mockImplementation((resource: string) => resource === "deals");
  });

  it("refuses a viewer who may not see jobs", () => {
    can.mockReturnValue(false);
    jobs.mockReturnValue(state());
    render(<MyJobsPage />);

    expect(screen.getByText(/don't have permission/i)).toBeInTheDocument();
  });

  it("says it is loading until the signed-in id has resolved, not '0 jobs'", () => {
    jobs.mockReturnValue(state({ ready: false }));
    render(<MyJobsPage />);

    expect(screen.getByText("Loading your day…")).toBeInTheDocument();
    expect(screen.queryByText(/0 jobs on your list/)).not.toBeInTheDocument();
  });

  it("lists each day under its own heading, with the count", () => {
    jobs.mockReturnValue(
      state({
        groups: groupJobsByDay(
          [
            deal({ id: "a", dealNumber: "AAA", scheduledDate: TODAY, scheduledTimeSlot: "09:00-11:00" }),
            deal({ id: "b", dealNumber: "BBB", scheduledDate: TODAY, scheduledTimeSlot: "13:00-15:00" }),
            deal({ id: "c", dealNumber: "CCC", scheduledDate: "2026-09-17" }),
          ],
          TODAY,
          "t1",
        ),
      }),
    );
    render(<MyJobsPage />);

    expect(screen.getByText("3 jobs on your list")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Today" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Tomorrow" })).toBeInTheDocument();
    expect(screen.getAllByTestId("tech-job-card")).toHaveLength(3);
  });

  it("shows an empty Today rather than a blank page", () => {
    jobs.mockReturnValue(state({ groups: groupJobsByDay([], TODAY) }));
    render(<MyJobsPage />);

    expect(screen.getByText("0 jobs on your list")).toBeInTheDocument();
    expect(screen.getByText(/nothing scheduled for today/i)).toBeInTheDocument();
  });

  it("carries the team-chat badge and refetches on the Refresh button", async () => {
    const refetch = vi.fn().mockResolvedValue(undefined);
    jobs.mockReturnValue(state({ refetch }));
    render(<MyJobsPage />);

    expect(screen.getByTestId("team-chat-badge")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Refresh" }));
    expect(refetch).toHaveBeenCalled();
  });

  it("says so when the list could not be loaded", () => {
    jobs.mockReturnValue(state({ isError: true }));
    render(<MyJobsPage />);

    expect(screen.getByText(/couldn't load your jobs/i)).toBeInTheDocument();
  });
});
