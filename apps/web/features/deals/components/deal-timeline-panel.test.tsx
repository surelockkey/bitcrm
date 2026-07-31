import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TimelineEventType, JobSuperStatus } from "@bitcrm/types";
import type { TimelineEntry } from "@bitcrm/types";

const entries: TimelineEntry[] = [
  {
    id: "e1",
    dealId: "d1",
    eventType: TimelineEventType.FIELD_UPDATED,
    actorId: "u1",
    actorName: "Olha D.",
    timestamp: "2026-07-29T10:00:00.000Z",
    details: { field: "priority", oldValue: "normal", newValue: "urgent" },
  },
  {
    id: "e2",
    dealId: "d1",
    eventType: TimelineEventType.STATUS_CHANGED,
    actorId: "u2",
    actorName: "Max K.",
    timestamp: "2026-07-28T09:00:00.000Z",
    details: {
      fromStatus: JobSuperStatus.SUBMITTED,
      toStatus: JobSuperStatus.IN_PROGRESS,
      fromSubStatusId: null,
      subStatusId: null,
    },
  },
  {
    id: "e3",
    dealId: "d1",
    eventType: TimelineEventType.NOTE_ADDED,
    actorId: "u1",
    actorName: "Olha D.",
    timestamp: "2026-07-27T08:00:00.000Z",
    details: {},
    note: "Called the client",
  },
];

vi.mock("../hooks", () => ({
  useDealTimeline: () => ({
    data: { pages: [{ data: entries, pagination: { nextCursor: undefined } }] },
    isLoading: false,
    hasNextPage: false,
    isFetchingNextPage: false,
    fetchNextPage: vi.fn(),
  }),
  useAddNote: () => ({ mutate: vi.fn(), isPending: false }),
}));

import { DealTimelinePanel } from "./deal-timeline-panel";

function openPanel() {
  render(<DealTimelinePanel dealId="d1" canEdit />);
  return userEvent.click(screen.getByRole("button", { name: /timeline/i }));
}

describe("DealTimelinePanel", () => {
  it("keeps the panel closed until the hanging handle is clicked", async () => {
    render(<DealTimelinePanel dealId="d1" canEdit />);

    expect(screen.queryByRole("complementary")).not.toBeInTheDocument();

    const handle = screen.getByRole("button", { name: /timeline/i });
    expect(handle).toHaveAttribute("aria-expanded", "false");
    await userEvent.click(handle);

    expect(screen.getByRole("complementary")).toBeInTheDocument();
  });

  it("shows who changed what, from what to what", async () => {
    await openPanel();

    // field change: old → new, with the actor
    expect(screen.getByText(/normal → urgent/i)).toBeInTheDocument();
    expect(screen.getAllByText(/Olha D\./).length).toBeGreaterThan(0);

    // status change: from → to
    expect(screen.getByText(/Submitted → In Progress/i)).toBeInTheDocument();
  });

  it("filters the timeline down to notes", async () => {
    await openPanel();

    await userEvent.click(screen.getByRole("button", { name: /^notes$/i }));

    expect(screen.getByText(/Called the client/)).toBeInTheDocument();
    expect(screen.queryByText(/normal → urgent/i)).not.toBeInTheDocument();
  });

  it("shows mocked demo data under the calls filter", async () => {
    await openPanel();

    await userEvent.click(screen.getByRole("button", { name: /^calls$/i }));

    expect(screen.getByText(/in progress/i)).toBeInTheDocument();
    expect(screen.getAllByText(/demo/i).length).toBeGreaterThan(0);
    expect(screen.queryByText(/normal → urgent/i)).not.toBeInTheDocument();
  });

  it("searches across the timeline", async () => {
    await openPanel();

    await userEvent.type(screen.getByPlaceholderText(/search/i), "priority");

    expect(screen.getByText(/normal → urgent/i)).toBeInTheDocument();
    expect(screen.queryByText(/Called the client/)).not.toBeInTheDocument();
  });

  it("lets an editor add a note", async () => {
    await openPanel();

    expect(screen.getByPlaceholderText(/add a note/i)).toBeInTheDocument();
  });
});
