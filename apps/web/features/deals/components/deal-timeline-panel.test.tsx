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

// `u-olha` is in the user map (resolves to her real name); `u-max` is not, so
// his stored label shows as-is (the fallback path).
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
const olha = { id: "u-olha", firstName: "Olha", lastName: "Datsiuk" } as User;

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
  useUserMap: () => ({ map: new Map([[roman.id, roman], [olha.id, olha]]) }),
  useContactMap: () => ({
    map: new Map([
      ["c-old", { id: "c-old", firstName: "Jane", lastName: "Smith" }],
      ["c-new", { id: "c-new", firstName: "Janet", lastName: "Poole" }],
    ]),
  }),
}));

// Catalog lookups: the timeline stores raw ids; the panel reads these to show
// the names people actually know things by.
vi.mock("@/features/job-statuses/hooks", () => ({
  useJobStatuses: () => ({ data: [{ id: "ss-waiting", name: "Waiting for parts" }] }),
}));
vi.mock("@/features/job-types/hooks", () => ({
  useJobTypes: () => ({ data: [{ id: "jt-lockout", name: "Lockout" }, { id: "jt-rekey", name: "Rekey" }] }),
}));
vi.mock("@/features/job-sources/hooks", () => ({
  useJobSources: () => ({ data: [{ id: "src-google", name: "Google Ads" }] }),
}));
vi.mock("@/features/external-companies/hooks", () => ({
  useExternalCompanies: () => ({ data: [{ id: "ec-1", name: "HomeServ" }] }),
}));
vi.mock("@/features/job-tags/hooks", () => ({
  useJobTags: () => ({ data: [{ id: "tag-vip", name: "VIP" }] }),
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

    // field change: old → new, with the actor's resolved name
    expect(screen.getByText(/normal → urgent/i)).toBeInTheDocument();
    expect(screen.getAllByText(/Olha Datsiuk/).length).toBeGreaterThan(0);

    // status change: from → to, actor unknown to the map → stored label
    expect(screen.getByText(/Submitted → In Progress/i)).toBeInTheDocument();
    expect(screen.getByText(/Max K\./)).toBeInTheDocument();
  });

  it("filters the timeline down to notes", async () => {
    render(<DealTimelinePanel dealId="d1" canEdit />);
    openPanel();

    await userEvent.click(screen.getByRole("button", { name: /^notes$/i }));

    expect(screen.getByText(/Called the client/)).toBeInTheDocument();
    expect(screen.queryByText(/normal → urgent/i)).not.toBeInTheDocument();
  });

  it("filters down to real linked calls — no demo data anywhere", async () => {
    timeline.entries = [
      ...historyEntries,
      entry({
        id: "call-1",
        eventType: TimelineEventType.CALL_LINKED,
        actorId: "u-olha",
        actorName: "Olha D.",
        timestamp: "2026-07-30T11:00:00.000Z",
        details: { direction: "inbound", from: "+14045551234", durationSeconds: 272, hasRecording: true },
      }),
    ];
    render(<DealTimelinePanel dealId="d1" canEdit />);
    openPanel();

    expect(screen.queryByText(/demo/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/integration is in progress/i)).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /^calls$/i }));

    expect(screen.getByText(/Incoming · \(404\) 555-1234 · 4:32 · recorded/)).toBeInTheDocument();
    expect(screen.queryByText(/normal → urgent/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Called the client/)).not.toBeInTheDocument();
  });

  it("has no Messages filter until an SMS feed actually exists", () => {
    render(<DealTimelinePanel dealId="d1" canEdit />);
    openPanel();

    expect(screen.queryByRole("button", { name: /^messages$/i })).not.toBeInTheDocument();
  });

  it("the Activities filter shows changes but not notes or calls", async () => {
    timeline.entries = [
      ...historyEntries,
      entry({
        id: "call-1",
        eventType: TimelineEventType.CALL_LINKED,
        timestamp: "2026-07-30T11:00:00.000Z",
        details: { direction: "inbound", from: "+14045551234" },
      }),
    ];
    render(<DealTimelinePanel dealId="d1" canEdit />);
    openPanel();

    await userEvent.click(screen.getByRole("button", { name: /^activities$/i }));

    expect(screen.getByText(/normal → urgent/i)).toBeInTheDocument();
    expect(screen.getByText(/Submitted → In Progress/i)).toBeInTheDocument();
    expect(screen.queryByText(/Called the client/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Incoming/)).not.toBeInTheDocument();
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

/**
 * The whole point of the history is that a raw id never reaches the reader:
 * every entry says who did what in the words people actually use.
 */
describe("DealTimelinePanel — every event reads human", () => {
  const show = (e: TimelineEntry) => {
    timeline.entries = [e];
    render(<DealTimelinePanel dealId="d1" canEdit />);
    openPanel();
  };

  it("names the technician on assign and unassign", () => {
    show(
      entry({
        eventType: TimelineEventType.TECH_ASSIGNED,
        details: { techId: "u-olha" },
      }),
    );
    expect(screen.getByText(/Technician assigned/)).toBeInTheDocument();
    expect(screen.getByText(/Olha Datsiuk/)).toBeInTheDocument();
  });

  it("names the technician on unassign via previousTechId", () => {
    show(
      entry({
        eventType: TimelineEventType.TECH_UNASSIGNED,
        details: { previousTechId: "u-olha" },
      }),
    );
    expect(screen.getByText(/Olha Datsiuk/)).toBeInTheDocument();
  });

  it("shows the sub-status name on a status change", () => {
    show(
      entry({
        eventType: TimelineEventType.STATUS_CHANGED,
        details: {
          fromStatus: JobSuperStatus.SUBMITTED,
          toStatus: JobSuperStatus.IN_PROGRESS,
          fromSubStatusId: null,
          subStatusId: "ss-waiting",
        },
      }),
    );
    expect(screen.getByText(/Submitted → In Progress · Waiting for parts/)).toBeInTheDocument();
  });

  it("resolves catalog ids in field changes to their names", () => {
    show(
      entry({
        eventType: TimelineEventType.FIELD_UPDATED,
        details: { field: "jobTypeId", oldValue: "jt-lockout", newValue: "jt-rekey" },
      }),
    );
    expect(screen.getByText(/Job type: Lockout → Rekey/)).toBeInTheDocument();
  });

  it("resolves a client change to the clients' names", () => {
    show(
      entry({
        eventType: TimelineEventType.FIELD_UPDATED,
        details: { field: "contactId", oldValue: "c-old", newValue: "c-new" },
      }),
    );
    expect(screen.getByText(/Client: Jane Smith → Janet Poole/)).toBeInTheDocument();
  });

  it("renders a 'Just here' rename as names, not JSON", () => {
    show(
      entry({
        eventType: TimelineEventType.FIELD_UPDATED,
        details: {
          field: "clientName",
          oldValue: null,
          newValue: { firstName: "Janet", lastName: "Poole" },
        },
      }),
    );
    expect(screen.getByText(/Client name: — → Janet Poole/)).toBeInTheDocument();
  });

  it("resolves tag ids to tag names", () => {
    show(
      entry({
        eventType: TimelineEventType.FIELD_UPDATED,
        details: { field: "tagIds", oldValue: [], newValue: ["tag-vip"] },
      }),
    );
    expect(screen.getByText(/Tags: — → VIP/)).toBeInTheDocument();
  });

  it("shows an added file by name", () => {
    show(
      entry({
        eventType: TimelineEventType.ATTACHMENT_ADDED,
        details: { attachmentId: "att-1", fileName: "before.jpg", category: "before" },
      }),
    );
    expect(screen.getByText(/File added/)).toBeInTheDocument();
    expect(screen.getByText(/before\.jpg · before/)).toBeInTheDocument();
  });

  it("shows a rename as old name → new name", () => {
    show(
      entry({
        eventType: TimelineEventType.ATTACHMENT_RENAMED,
        details: {
          attachmentId: "att-1",
          fileName: "front door.jpg",
          previousFileName: "before.jpg",
        },
      }),
    );
    expect(screen.getByText(/before\.jpg → front door\.jpg/)).toBeInTheDocument();
  });

  it("shows a removed file by name", () => {
    show(
      entry({
        eventType: TimelineEventType.ATTACHMENT_REMOVED,
        details: { attachmentId: "att-1", fileName: "before.jpg" },
      }),
    );
    expect(screen.getByText(/File removed/)).toBeInTheDocument();
  });
});
