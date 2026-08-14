import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TimelineEventType, JobSuperStatus } from "@bitcrm/types";
import type { TimelineEntry, User } from "@bitcrm/types";

const { updateNoteMutate, deleteNoteMutate, timeline } = vi.hoisted(() => ({
  updateNoteMutate: vi.fn(),
  deleteNoteMutate: vi.fn(),
  timeline: { entries: [] as unknown[] },
}));

const entry = (over: Partial<TimelineEntry>): TimelineEntry => ({
  id: "e1",
  dealId: "d1",
  eventType: TimelineEventType.NOTE_ADDED,
  actorId: "u1",
  actorName: "roman@surelockkey.com",
  timestamp: "2026-08-01T10:00:00.000Z",
  details: {},
  ...over,
});

// Actor ids intentionally absent from the user map — their stored labels must
// show as-is (the fallback path).
const historyEntries: TimelineEntry[] = [
  entry({
    id: "h1",
    eventType: TimelineEventType.FIELD_UPDATED,
    actorId: "u-olha",
    actorName: "Olha D.",
    timestamp: "2026-07-29T10:00:00.000Z",
    details: { field: "priority", oldValue: "normal", newValue: "urgent" },
  }),
  entry({
    id: "h2",
    eventType: TimelineEventType.STATUS_CHANGED,
    actorId: "u-max",
    actorName: "Max K.",
    timestamp: "2026-07-28T09:00:00.000Z",
    details: {
      fromStatus: JobSuperStatus.SUBMITTED,
      toStatus: JobSuperStatus.IN_PROGRESS,
      fromSubStatusId: null,
      subStatusId: null,
    },
  }),
  entry({
    id: "h3",
    actorId: "u-olha",
    actorName: "Olha D.",
    timestamp: "2026-07-27T08:00:00.000Z",
    note: "Called the client",
  }),
];

const roman = { id: "u1", firstName: "Roman", lastName: "Senyshyn" } as User;

vi.mock("../hooks", () => ({
  useDealTimeline: () => ({
    data: { pages: [{ data: timeline.entries, pagination: { nextCursor: undefined } }] },
    isLoading: false,
    hasNextPage: false,
    isFetchingNextPage: false,
    fetchNextPage: vi.fn(),
  }),
  useAddNote: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateNote: () => ({ mutate: updateNoteMutate, isPending: false }),
  useDeleteNote: () => ({ mutate: deleteNoteMutate, isPending: false }),
  useUserMap: () => ({ map: new Map([[roman.id, roman]]) }),
}));

// Radix confirm dialog; render children directly.
vi.mock("@/components/ui/alert-dialog", () => ({
  AlertDialog: ({ open, children }: { open?: boolean; children: React.ReactNode }) =>
    open ? <div role="alertdialog">{children}</div> : null,
  AlertDialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AlertDialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AlertDialogTitle: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AlertDialogDescription: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AlertDialogFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AlertDialogCancel: ({ children }: { children: React.ReactNode }) => <button type="button">{children}</button>,
  AlertDialogAction: ({ children, onClick }: { children: React.ReactNode; onClick?: React.MouseEventHandler }) => (
    <button type="button" onClick={onClick}>{children}</button>
  ),
}));

import { DealTimelinePanel } from "./deal-timeline-panel";

const openPanel = () => fireEvent.click(screen.getByRole("button", { name: /timeline/i }));

beforeEach(() => {
  updateNoteMutate.mockReset();
  deleteNoteMutate.mockReset();
  timeline.entries = historyEntries;
});

describe("DealTimelinePanel — history, filters, search", () => {
  it("keeps the panel closed until the hanging handle is clicked", async () => {
    render(<DealTimelinePanel dealId="d1" canEdit />);

    expect(screen.queryByRole("complementary")).not.toBeInTheDocument();

    const handle = screen.getByRole("button", { name: /timeline/i });
    expect(handle).toHaveAttribute("aria-expanded", "false");
    await userEvent.click(handle);

    expect(screen.getByRole("complementary")).toBeInTheDocument();
  });

  it("shows who changed what, from what to what", async () => {
    render(<DealTimelinePanel dealId="d1" canEdit />);
    openPanel();

    // field change: old → new, with the actor
    expect(screen.getByText(/normal → urgent/i)).toBeInTheDocument();
    expect(screen.getAllByText(/Olha D\./).length).toBeGreaterThan(0);

    // status change: from → to
    expect(screen.getByText(/Submitted → In Progress/i)).toBeInTheDocument();
  });

  it("filters the timeline down to notes", async () => {
    render(<DealTimelinePanel dealId="d1" canEdit />);
    openPanel();

    await userEvent.click(screen.getByRole("button", { name: /^notes$/i }));

    expect(screen.getByText(/Called the client/)).toBeInTheDocument();
    expect(screen.queryByText(/normal → urgent/i)).not.toBeInTheDocument();
  });

  it("shows mocked demo data under the calls filter", async () => {
    render(<DealTimelinePanel dealId="d1" canEdit />);
    openPanel();

    await userEvent.click(screen.getByRole("button", { name: /^calls$/i }));

    expect(screen.getByText(/in progress/i)).toBeInTheDocument();
    expect(screen.getAllByText(/demo/i).length).toBeGreaterThan(0);
    expect(screen.queryByText(/normal → urgent/i)).not.toBeInTheDocument();
  });

  it("searches across the timeline", async () => {
    render(<DealTimelinePanel dealId="d1" canEdit />);
    openPanel();

    await userEvent.type(screen.getByPlaceholderText(/search/i), "priority");

    expect(screen.getByText(/normal → urgent/i)).toBeInTheDocument();
    expect(screen.queryByText(/Called the client/)).not.toBeInTheDocument();
  });

  it("lets an editor add a note", async () => {
    render(<DealTimelinePanel dealId="d1" canEdit />);
    openPanel();

    expect(screen.getByPlaceholderText(/add a note/i)).toBeInTheDocument();
  });

  it("keeps the chosen filter when the panel is closed and reopened", async () => {
    render(<DealTimelinePanel dealId="d1" canEdit />);
    const handle = screen.getByRole("button", { name: /timeline/i });

    await userEvent.click(handle);
    await userEvent.click(screen.getByRole("button", { name: /^calls$/i }));
    expect(screen.getByText(/in progress/i)).toBeInTheDocument();

    // The panel slides away (stays mounted for the animation) but must leave
    // the accessibility tree; its state survives the round trip.
    await userEvent.click(screen.getByRole("button", { name: /close timeline/i }));
    expect(screen.queryByRole("complementary")).not.toBeInTheDocument();

    await userEvent.click(handle);
    expect(screen.getByRole("button", { name: /^calls$/i })).toHaveAttribute("aria-pressed", "true");
  });
});

describe("DealTimelinePanel — notes editing and actor names", () => {
  beforeEach(() => {
    timeline.entries = [entry({ note: "Call the client back" })];
  });

  it("shows the actor's name, not their email", () => {
    render(<DealTimelinePanel dealId="d1" canEdit />);
    openPanel();

    expect(screen.getByText(/Roman Senyshyn/)).toBeInTheDocument();
    expect(screen.queryByText(/roman@surelockkey\.com/)).not.toBeInTheDocument();
  });

  it("falls back to the stored actor name when the id is not a known user", () => {
    timeline.entries = [entry({ actorId: "sys", actorName: "Payment Service" })];
    render(<DealTimelinePanel dealId="d1" canEdit />);
    openPanel();

    expect(screen.getByText(/Payment Service/)).toBeInTheDocument();
  });

  it("edits a note in place and saves through the notes endpoint", () => {
    render(<DealTimelinePanel dealId="d1" canEdit />);
    openPanel();

    fireEvent.click(screen.getByRole("button", { name: "Edit note" }));
    const box = screen.getByDisplayValue("Call the client back");
    fireEvent.change(box, { target: { value: "Client called back already" } });
    fireEvent.click(screen.getByRole("button", { name: "Save note" }));

    expect(updateNoteMutate).toHaveBeenCalledWith(
      {
        entryId: "e1",
        timestamp: "2026-08-01T10:00:00.000Z",
        note: "Client called back already",
      },
      expect.anything(),
    );
  });

  it("deletes a note after a confirmation", () => {
    render(<DealTimelinePanel dealId="d1" canEdit />);
    openPanel();

    fireEvent.click(screen.getByRole("button", { name: "Delete note" }));
    expect(deleteNoteMutate).not.toHaveBeenCalled();

    const confirm = screen.getByRole("alertdialog");
    fireEvent.click(within(confirm).getByRole("button", { name: "Delete" }));
    expect(deleteNoteMutate).toHaveBeenCalledWith({
      entryId: "e1",
      timestamp: "2026-08-01T10:00:00.000Z",
    });
  });

  it("offers no note actions to read-only users", () => {
    render(<DealTimelinePanel dealId="d1" canEdit={false} />);
    openPanel();

    expect(screen.queryByRole("button", { name: "Edit note" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete note" })).not.toBeInTheDocument();
  });

  it("spells out item money changes on a product_updated entry", () => {
    timeline.entries = [
      entry({
        id: "e2",
        eventType: TimelineEventType.PRODUCT_UPDATED,
        note: undefined,
        details: {
          productId: "p1",
          productName: "Deadbolt",
          quantity: 2,
          changes: {
            priceClient: { from: 45, to: 60 },
            costCompany: { from: 15, to: 18 },
          },
        },
      }),
    ];
    render(<DealTimelinePanel dealId="d1" canEdit />);
    openPanel();

    expect(screen.getByText(/Price: \$45\.00 → \$60\.00/)).toBeInTheDocument();
    expect(screen.getByText(/Cost \(company\): \$15\.00 → \$18\.00/)).toBeInTheDocument();
  });
});
