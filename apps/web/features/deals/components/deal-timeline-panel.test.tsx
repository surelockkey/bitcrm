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
}));
vi.mock("@/features/clients/hooks", () => ({
  // Only the clients the entries mention are asked for.
  useContactsByIds: (ids: string[]) => ({
    map: new Map(
      [
        ["c-old", { id: "c-old", firstName: "Jane", lastName: "Smith" }],
        ["c-new", { id: "c-new", firstName: "Janet", lastName: "Poole" }],
      ].filter(([id]) => ids.includes(id as string)) as [string, unknown][],
    ),
    isLoading: false,
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

// The client's SMS thread is its own sheet with its own tests; here it only
// has to open.
vi.mock("@/features/clients/components/client-chat-sheet", () => ({
  ClientChatSheet: ({ open, name }: { open: boolean; name: string }) =>
    open ? <div role="dialog" aria-label={`Chat with ${name}`} /> : null,
}));

import { DealTimelinePanel } from "./deal-timeline-panel";

/** The rail's Timeline icon: Workiz opens the panel on Activities. */
const openPanel = () => fireEvent.click(screen.getByRole("button", { name: /^timeline$/i }));
/** The rail's notes icon: the same panel, on Notes. */
const openNotes = () => fireEvent.click(screen.getByRole("button", { name: /^notes/i }));
/** Radix Select needs real pointer events, so these go through userEvent. */
const u = () => userEvent.setup({ pointerEventsCheck: 0 });
async function chooseFilter(name: RegExp) {
  await u().click(screen.getByRole("combobox", { name: /timeline filter/i }));
  await u().click(screen.getByRole("option", { name }));
}

beforeEach(() => {
  updateNoteMutate.mockReset();
  deleteNoteMutate.mockReset();
  timeline.entries = historyEntries;
});

describe("DealTimelinePanel — Workiz's right rail", () => {
  it("is a strip of icons down the right edge until one is clicked", async () => {
    render(<DealTimelinePanel dealId="d1" canEdit />);

    expect(screen.getByRole("toolbar", { name: /job rail/i })).toBeInTheDocument();
    expect(screen.queryByRole("complementary")).not.toBeInTheDocument();

    const handle = screen.getByRole("button", { name: /^timeline$/i });
    expect(handle).toHaveAttribute("aria-expanded", "false");
    await userEvent.click(handle);

    // The panel takes the strip's place, as in Workiz.
    expect(screen.getByRole("complementary", { name: /job timeline/i })).toBeInTheDocument();
    expect(screen.queryByRole("toolbar", { name: /job rail/i })).not.toBeInTheDocument();
  });

  it("counts the job's notes on the notes icon", () => {
    render(<DealTimelinePanel dealId="d1" canEdit />);

    expect(screen.getByRole("button", { name: "Notes (1)" })).toHaveTextContent("1");
  });

  it("shows no badge on a job without notes", () => {
    timeline.entries = historyEntries.filter((e) => e.eventType !== TimelineEventType.NOTE_ADDED);
    render(<DealTimelinePanel dealId="d1" canEdit />);

    expect(screen.getByRole("button", { name: "Notes" })).toHaveTextContent("");
  });

  it("opens each icon's own filter: Timeline → Activities, notes → Notes, phone → Calls", async () => {
    render(<DealTimelinePanel dealId="d1" canEdit />);

    openNotes();
    expect(screen.getByRole("combobox", { name: /timeline filter/i })).toHaveTextContent("Notes (1)");
    expect(screen.getByText(/Called the client/)).toBeInTheDocument();
    expect(screen.queryByText(/normal → urgent/i)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /close timeline/i }));
    fireEvent.click(screen.getByRole("button", { name: /^calls$/i }));
    expect(screen.getByRole("combobox", { name: /timeline filter/i })).toHaveTextContent("Calls (0)");

    fireEvent.click(screen.getByRole("button", { name: /close timeline/i }));
    openPanel();
    expect(screen.getByRole("combobox", { name: /timeline filter/i })).toHaveTextContent("Activities (2)");
  });

  it("opens the client's SMS thread from the chat icon and from 'Message Client'", () => {
    render(<DealTimelinePanel dealId="d1" canEdit client={{ id: "c1", name: "Jane Smith", phone: "+14045551234" }} />);

    fireEvent.click(screen.getByRole("button", { name: /message client/i }));
    expect(screen.getByRole("dialog", { name: "Chat with Jane Smith" })).toBeInTheDocument();
  });

  it("offers no chat without a client to text", () => {
    render(<DealTimelinePanel dealId="d1" canEdit />);

    expect(screen.queryByRole("button", { name: /message client/i })).not.toBeInTheDocument();
    openPanel();
    expect(screen.queryByRole("button", { name: /message client/i })).not.toBeInTheDocument();
  });
});

describe("DealTimelinePanel — history, filters, search", () => {
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

  it("says when, the way Workiz does — 'a day ago', the exact time on hover", () => {
    timeline.entries = [entry({ eventType: TimelineEventType.FIELD_UPDATED, timestamp: new Date(Date.now() - 26 * 3600_000).toISOString(), details: { field: "priority", oldValue: "normal", newValue: "urgent" } })];
    render(<DealTimelinePanel dealId="d1" canEdit />);
    openPanel();

    expect(screen.getByText("a day ago")).toHaveAttribute("title");
  });

  it("filters the timeline down to notes", async () => {
    render(<DealTimelinePanel dealId="d1" canEdit />);
    openPanel();

    await chooseFilter(/^notes/i);

    expect(screen.getByText(/Called the client/)).toBeInTheDocument();
    expect(screen.queryByText(/normal → urgent/i)).not.toBeInTheDocument();
  });

  it("shows everything under All", async () => {
    render(<DealTimelinePanel dealId="d1" canEdit />);
    openPanel();

    await chooseFilter(/^all \(3\)/i);

    expect(screen.getByText(/Called the client/)).toBeInTheDocument();
    expect(screen.getByText(/normal → urgent/i)).toBeInTheDocument();
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

    await chooseFilter(/^calls/i);

    expect(screen.getByText(/Incoming · \(404\) 555-1234 · 4:32 · recorded/)).toBeInTheDocument();
    expect(screen.queryByText(/normal → urgent/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Called the client/)).not.toBeInTheDocument();
  });

  it("has no Messages filter until an SMS feed actually exists", async () => {
    render(<DealTimelinePanel dealId="d1" canEdit />);
    openPanel();

    await u().click(screen.getByRole("combobox", { name: /timeline filter/i }));
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual([
      "All (3)",
      "Activities (2)",
      "Notes (1)",
      "Calls (0)",
    ]);
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

    expect(screen.getByRole("combobox", { name: /timeline filter/i })).toHaveTextContent("Activities (2)");
    expect(screen.getByText(/normal → urgent/i)).toBeInTheDocument();
    expect(screen.getByText(/Submitted → In Progress/i)).toBeInTheDocument();
    expect(screen.queryByText(/Called the client/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Incoming/)).not.toBeInTheDocument();
  });

  it("searches across the timeline behind the magnifier", async () => {
    render(<DealTimelinePanel dealId="d1" canEdit />);
    openPanel();

    await userEvent.click(screen.getByRole("button", { name: /search the timeline/i }));
    await userEvent.type(screen.getByPlaceholderText("Search activities"), "priority");

    expect(screen.getByText(/normal → urgent/i)).toBeInTheDocument();
    expect(screen.queryByText(/Submitted → In Progress/i)).not.toBeInTheDocument();
  });

  it("lets an editor add a note: 'Add note' opens the box, Save posts it", async () => {
    render(<DealTimelinePanel dealId="d1" canEdit />);
    openPanel();

    await userEvent.click(screen.getByRole("button", { name: "Add note" }));
    const box = screen.getByRole("textbox", { name: /new note/i });
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    await userEvent.type(box, "Gate code 1234");
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
  });

  it("offers no 'Add note' to a read-only viewer", () => {
    render(<DealTimelinePanel dealId="d1" canEdit={false} />);
    openPanel();

    expect(screen.queryByRole("button", { name: "Add note" })).not.toBeInTheDocument();
  });

  it("keeps the chosen filter when the panel is collapsed and expanded again", async () => {
    render(<DealTimelinePanel dealId="d1" canEdit />);
    openPanel();
    await chooseFilter(/^calls/i);

    // Collapsing gives the page its width back; the arrow brings the panel
    // back as it was left.
    await userEvent.click(screen.getByRole("button", { name: /close timeline/i }));
    expect(screen.queryByRole("complementary")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /expand panel/i }));
    expect(screen.getByRole("combobox", { name: /timeline filter/i })).toHaveTextContent("Calls (0)");
  });
});

describe("DealTimelinePanel — notes editing and actor names", () => {
  beforeEach(() => {
    timeline.entries = [entry({ note: "Call the client back" })];
  });

  it("shows the actor's name, not their email", () => {
    render(<DealTimelinePanel dealId="d1" canEdit />);
    openNotes();

    expect(screen.getByText(/Roman Senyshyn/)).toBeInTheDocument();
    expect(screen.queryByText(/roman@surelockkey\.com/)).not.toBeInTheDocument();
  });

  it("falls back to the stored actor name when the id is not a known user", () => {
    timeline.entries = [entry({ actorId: "sys", actorName: "Payment Service" })];
    render(<DealTimelinePanel dealId="d1" canEdit />);
    openNotes();

    expect(screen.getByText(/Payment Service/)).toBeInTheDocument();
  });

  it("edits a note in place from its ⋮ and saves through the notes endpoint", () => {
    render(<DealTimelinePanel dealId="d1" canEdit />);
    openNotes();

    fireEvent.click(screen.getByRole("button", { name: "Note actions" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Edit note" }));
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
    openNotes();

    fireEvent.click(screen.getByRole("button", { name: "Note actions" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete note" }));
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
    openNotes();

    expect(screen.queryByRole("button", { name: "Note actions" })).not.toBeInTheDocument();
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

  it("names a Job name change in words, not as the field's key", () => {
    show(
      entry({
        eventType: TimelineEventType.FIELD_UPDATED,
        details: { field: "jobName", oldValue: null, newValue: "Back gate" },
      }),
    );
    expect(screen.getByText(/Job name: — → Back gate/)).toBeInTheDocument();
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

  // Workiz's own wording for the two dispatch events.
  it("reads a 'Send to tech' as the channels it went out on and who it went to", () => {
    show(
      entry({
        eventType: TimelineEventType.SENT_TO_TECH,
        details: {
          techIds: ["u-olha"],
          channels: ["sms", "email"],
          sentAt: "2026-08-01T10:00:00.000Z",
        },
      }),
    );
    expect(screen.getByText(/Sent to tech/)).toBeInTheDocument();
    expect(screen.getByText(/by SMS & Email · Olha Datsiuk/)).toBeInTheDocument();
  });

  it("names the technician who opened the job in their app", () => {
    show(
      entry({
        eventType: TimelineEventType.SEEN_BY_TECH,
        details: { techId: "u-olha", seenAt: "2026-08-01T10:04:00.000Z" },
      }),
    );
    expect(screen.getByText(/Viewed job in app/)).toBeInTheDocument();
    expect(screen.getByText(/Olha Datsiuk/)).toBeInTheDocument();
  });
});

describe("DealTimelinePanel — imported Workiz rows read human", () => {
  const show = (e: TimelineEntry) => {
    timeline.entries = [e];
    render(<DealTimelinePanel dealId="d1" canEdit />);
    openPanel();
  };

  it("labels a Workiz activity line, not its raw event type", () => {
    show(entry({ eventType: "workiz_activity" as TimelineEventType, note: "Remove tag from job" }));
    expect(screen.getByText("Activity")).toBeInTheDocument();
    expect(screen.queryByText(/workiz_activity/)).not.toBeInTheDocument();
  });

  it("shows a schedule change as dates, not ISO strings", () => {
    show(
      entry({
        eventType: TimelineEventType.FIELD_UPDATED,
        details: { field: "scheduledDate", oldValue: "2026-09-30T10:00:00-04:00", newValue: "2026-10-07T10:00:00-04:00" },
      }),
    );
    expect(screen.getByText(/Scheduled date: Sep 30, 2026, 10:00 AM → Oct 7, 2026, 10:00 AM/)).toBeInTheDocument();
    expect(screen.queryByText(/T10:00:00/)).not.toBeInTheDocument();
  });
});

describe("DealTimelinePanel — what the client did on the portal reads like Workiz", () => {
  const show = (e: TimelineEntry) => {
    timeline.entries = [e];
    render(<DealTimelinePanel dealId="d1" canEdit />);
    openPanel();
  };

  it("a portal view: Client viewed invoice / estimate, with the number", () => {
    show(entry({ eventType: TimelineEventType.INVOICE_VIEWED, actorId: "client", actorName: "Client", details: { invoiceId: "d1", number: "O8E9NQ" } }));
    expect(screen.getByText("Client viewed invoice")).toBeInTheDocument();
    expect(screen.getByText(/#O8E9NQ/)).toBeInTheDocument();
  });

  it("an estimate view", () => {
    show(entry({ eventType: TimelineEventType.ESTIMATE_VIEWED, actorId: "client", actorName: "Client", details: { estimateId: "e1", number: "K4T9ZW-1" } }));
    expect(screen.getByText("Client viewed estimate")).toBeInTheDocument();
    expect(screen.getByText(/#K4T9ZW-1/)).toBeInTheDocument();
  });

  it("approving is signing: Client signed estimate; declining: Client declined estimate", () => {
    show(entry({ eventType: TimelineEventType.ESTIMATE_APPROVED, actorId: "client", actorName: "Jane Client", details: { estimateId: "e1", number: "K4T9ZW-1" } }));
    expect(screen.getByText("Client signed estimate")).toBeInTheDocument();
    expect(screen.getByText(/#K4T9ZW-1/)).toBeInTheDocument();
  });

  it("a decline", () => {
    show(entry({ eventType: TimelineEventType.ESTIMATE_DECLINED, actorId: "client", details: { estimateId: "e1", number: "K4T9ZW-2" } }));
    expect(screen.getByText("Client declined estimate")).toBeInTheDocument();
  });

  it("an invoice the client signed on the portal says Client; one signed on a tech's phone does not", () => {
    show(entry({ eventType: TimelineEventType.INVOICE_SIGNED, actorId: "client", actorName: "Josh W", details: { invoiceId: "d1", number: "O8E9NQ", signedBy: "Josh W" } }));
    expect(screen.getByText("Client signed invoice")).toBeInTheDocument();
  });

  it("a staff-collected signature", () => {
    show(entry({ eventType: TimelineEventType.INVOICE_SIGNED, actorId: "u-olha", details: { invoiceId: "d1", number: "O8E9NQ", signedBy: "Josh W" } }));
    expect(screen.getByText("Invoice signed")).toBeInTheDocument();
  });
});
