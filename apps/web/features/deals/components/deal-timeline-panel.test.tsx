import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TimelineEventType, JobSuperStatus } from "@bitcrm/types";
import type { TimelineEntry, User } from "@bitcrm/types";

const { updateNoteMutate, deleteNoteMutate, timeline, inbox } = vi.hoisted(() => ({
  updateNoteMutate: vi.fn(),
  deleteNoteMutate: vi.fn(),
  timeline: { entries: [] as unknown[] },
  inbox: { messages: [] as unknown[], enabled: [] as boolean[] },
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
// has to open, on the number it was handed.
vi.mock("@/features/clients/components/client-chat-sheet", () => ({
  ClientChatSheet: ({ open, name, phone }: { open: boolean; name: string; phone?: string }) =>
    open ? <div role="dialog" aria-label={`Chat with ${name}`} data-phone={phone} /> : null,
}));

// The job's messages (messaging's per-job feed).
vi.mock("@/features/messaging/hooks", () => ({
  useMessagesByJob: (_dealId: string, enabled = true) => {
    inbox.enabled.push(enabled);
    return {
      data: enabled ? { pages: [{ data: inbox.messages, pagination: { nextCursor: undefined } }] } : undefined,
      isLoading: false,
      hasNextPage: false,
      isFetchingNextPage: false,
      fetchNextPage: vi.fn(),
    };
  },
}));

const message = (over: Record<string, unknown>) => ({
  id: "m1",
  conversationId: "c1",
  channel: "sms",
  direction: "outbound",
  origin: "user",
  status: "delivered",
  dealId: "d1",
  createdAt: "2026-07-31T10:00:00.000Z",
  updatedAt: "2026-07-31T10:00:00.000Z",
  ...over,
});

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
  inbox.messages = [];
  inbox.enabled = [];
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

  // The owner: "the timeline beside it must be a timeline of the messages, not a chat".
  it("the chat icon opens the same Timeline on Messages — no chat window", () => {
    inbox.messages = [
      message({ id: "m1", sentByName: "(1) (Mia) 7 Dispatcher", body: "New job #5TU7ZA\nDustin Roselle" }),
      message({ id: "m2", direction: "inbound", origin: "contact", from: "+14045551234", body: "Thanks!" }),
    ];
    render(<DealTimelinePanel dealId="d1" canEdit canViewMessages chat={{ contactId: "c1", name: "Jane Smith" }} />);

    fireEvent.click(screen.getByRole("button", { name: /^messages$/i }));

    expect(screen.getByRole("complementary", { name: /job timeline/i })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: /timeline filter/i })).toHaveTextContent("Messages (2)");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByText("(1) (Mia) 7 Dispatcher")).toBeInTheDocument();
    expect(screen.getByText(/New job #5TU7ZA/)).toBeInTheDocument();
    expect(screen.getByText("Thanks!")).toBeInTheDocument();
    // Only messages under Messages.
    expect(screen.queryByText(/Called the client/)).not.toBeInTheDocument();
  });

  it("'Message Client' opens the client's conversation, on the number it was given", () => {
    render(
      <DealTimelinePanel dealId="d1" canEdit canViewMessages chat={{ contactId: "c1", name: "Jane Smith", phone: "+15715310137", phoneOnContact: false }} />,
    );
    openPanel();

    fireEvent.click(screen.getByRole("button", { name: /message client/i }));
    expect(screen.getByRole("dialog", { name: "Chat with Jane Smith" })).toHaveAttribute("data-phone", "+15715310137");
  });

  it("offers no 'Message Client' without a client to text", () => {
    render(<DealTimelinePanel dealId="d1" canEdit canViewMessages />);
    openPanel();

    expect(screen.queryByRole("button", { name: /message client/i })).not.toBeInTheDocument();
  });

  it("a viewer who may not read messages gets no Messages icon and asks for none", () => {
    render(<DealTimelinePanel dealId="d1" canEdit />);

    expect(screen.queryByRole("button", { name: /^messages$/i })).not.toBeInTheDocument();
    expect(inbox.enabled.every((e) => e === false)).toBe(true);
  });

  it("names each icon in Workiz's dark tooltip — 'Actions' on the history icon", async () => {
    render(<DealTimelinePanel dealId="d1" canEdit canViewMessages />);

    await userEvent.hover(screen.getByRole("button", { name: /^timeline$/i }));
    expect(await screen.findByRole("tooltip")).toHaveTextContent("Actions");
  });
});

describe("DealTimelinePanel — history, filters, search", () => {
  it("says what happened in Workiz's words, and what changed on the next line", async () => {
    render(<DealTimelinePanel dealId="d1" canEdit />);
    openPanel();

    // field change: Workiz's "Update job details", then old → new; the actor's resolved name
    expect(screen.getByText(/Update job details\s+Priority: Normal → Urgent/)).toBeInTheDocument();
    expect(screen.getAllByText(/Olha Datsiuk/).length).toBeGreaterThan(0);
    expect(screen.queryByText("Field updated")).not.toBeInTheDocument();

    // status change, actor unknown to the map → stored label
    expect(screen.getByText(/Status Updated - In Progress -/)).toBeInTheDocument();
    expect(screen.getByText(/Max K\./)).toBeInTheDocument();
  });

  it("draws job changes with Workiz's laptop-and-phone icon", () => {
    render(<DealTimelinePanel dealId="d1" canEdit />);
    openPanel();

    expect(screen.getAllByTitle("Web App").length).toBe(2);
  });

  it("words a reschedule as one sentence, read back from the visit the job has now", () => {
    timeline.entries = [
      entry({ id: "r1", eventType: TimelineEventType.FIELD_UPDATED, timestamp: "2026-10-08T15:00:01.000Z", details: { field: "scheduledTimeSlot", oldValue: "08:30-09:00", newValue: "18:00-19:00" } }),
      entry({ id: "r2", eventType: TimelineEventType.FIELD_UPDATED, timestamp: "2026-10-08T15:00:00.000Z", details: { field: "scheduledDate", oldValue: "2026-10-07", newValue: "2026-10-08" } }),
    ];
    render(<DealTimelinePanel dealId="d1" canEdit schedule={{ date: "2026-10-08", slot: "18:00-19:00" }} />);
    openPanel();

    expect(screen.getByRole("combobox", { name: /timeline filter/i })).toHaveTextContent("Activities (1)");
    expect(
      screen.getByText("Rescheduled job from Wed Oct 07 2026 8:30 am - 9:00 am to Thu Oct 08 2026 6:00 pm - 7:00 pm"),
    ).toBeInTheDocument();
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

    expect(screen.getByText(/Call from \(404\) 555-1234\s+4:32 · recorded/)).toBeInTheDocument();
    expect(screen.queryByText(/normal → urgent/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Called the client/)).not.toBeInTheDocument();
  });

  it("names the job's client on a call ('Called Dustin Roselle')", async () => {
    timeline.entries = [
      entry({ id: "call-2", eventType: TimelineEventType.CALL_LINKED, details: { direction: "outbound", to: "+14045551234" } }),
    ];
    render(<DealTimelinePanel dealId="d1" canEdit client={{ name: "Dustin Roselle", phones: [] }} />);
    fireEvent.click(screen.getByRole("button", { name: /^calls$/i }));

    expect(screen.getByText("Called Dustin Roselle")).toBeInTheDocument();
  });

  it("lists Workiz's five filters, Messages counted in All (rail_chat_dropdown)", async () => {
    inbox.messages = [message({ id: "m1", body: "On my way" }), message({ id: "m2", body: "Done" })];
    render(<DealTimelinePanel dealId="d1" canEdit canViewMessages />);
    openPanel();

    await u().click(screen.getByRole("combobox", { name: /timeline filter/i }));
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual([
      "All (5)",
      "Activities (2)",
      "Notes (1)",
      "Calls (0)",
      "Messages (2)",
    ]);
  });

  it("All shows the messages among the rest, newest first", async () => {
    inbox.messages = [message({ id: "m1", body: "On my way", createdAt: "2026-07-28T12:00:00.000Z" })];
    render(<DealTimelinePanel dealId="d1" canEdit canViewMessages />);
    openPanel();
    await chooseFilter(/^all/i);

    const texts = screen.getAllByRole("listitem").map((li) => li.textContent ?? "");
    // Jul 29 change, then this Jul 28 noon text, then the Jul 28 morning status change.
    expect(texts.findIndex((t) => t.includes("On my way"))).toBe(1);
  });

  it("offers no Messages filter to a viewer who may not read messages", async () => {
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
    expect(screen.getByText(/Status Updated - In Progress -/)).toBeInTheDocument();
    expect(screen.queryByText(/Called the client/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Incoming/)).not.toBeInTheDocument();
  });

  it("searches across the timeline behind the magnifier", async () => {
    render(<DealTimelinePanel dealId="d1" canEdit />);
    openPanel();

    await userEvent.click(screen.getByRole("button", { name: /search the timeline/i }));
    await userEvent.type(screen.getByPlaceholderText("Search activities"), "priority");

    expect(screen.getByText(/normal → urgent/i)).toBeInTheDocument();
    expect(screen.queryByText(/Status Updated - In Progress -/)).not.toBeInTheDocument();
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

  // J6: Workiz's box is empty (no placeholder), capped at 1000 with its counter.
  it("caps a note at 1000 characters and counts them, Workiz's '14 / 1000'", async () => {
    render(<DealTimelinePanel dealId="d1" canEdit />);
    openPanel();

    await userEvent.click(screen.getByRole("button", { name: "Add note" }));
    const box = screen.getByRole("textbox", { name: /new note/i });
    expect(box).toHaveAttribute("maxLength", "1000");
    expect(box).not.toHaveAttribute("placeholder");
    await userEvent.type(box, "Gate code 1234");
    expect(screen.getByText("14 / 1000")).toBeInTheDocument();
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
    expect(screen.getByText("Tech Assigned - Olha Datsiuk")).toBeInTheDocument();
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
    expect(screen.getByText("Status Updated - In Progress - Waiting for parts")).toBeInTheDocument();
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
    expect(screen.getByText("Added tag - VIP")).toBeInTheDocument();
  });

  it("shows an added file by name", () => {
    show(
      entry({
        eventType: TimelineEventType.ATTACHMENT_ADDED,
        details: { attachmentId: "att-1", fileName: "before.jpg", category: "before" },
      }),
    );
    expect(screen.getByText("Saved Attachment - before.jpg")).toBeInTheDocument();
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
    expect(screen.getByText("Deleted Attachment - before.jpg")).toBeInTheDocument();
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
    expect(screen.getByText("Sent to tech by SMS & Email - Olha Datsiuk")).toBeInTheDocument();
  });

  it("the technician who opened the job in their app is the row's actor, under the phone icon", () => {
    show(
      entry({
        eventType: TimelineEventType.SEEN_BY_TECH,
        actorId: "u-olha",
        details: { techId: "u-olha", seenAt: "2026-08-01T10:04:00.000Z" },
      }),
    );
    expect(screen.getByText("Viewed job in app")).toBeInTheDocument();
    expect(screen.getByText("Olha Datsiuk")).toBeInTheDocument();
    expect(screen.getByTitle("Mobile App")).toBeInTheDocument();
  });
});

describe("DealTimelinePanel — imported Workiz rows read human", () => {
  const show = (e: TimelineEntry) => {
    timeline.entries = [e];
    render(<DealTimelinePanel dealId="d1" canEdit />);
    openPanel();
  };

  // J5: "Activity / “Added tag”" read nothing like Workiz's one plain line.
  it("reads a Workiz activity line as Workiz wrote it — no 'Activity' label, no quotes", () => {
    show(entry({ eventType: "workiz_activity" as TimelineEventType, note: "Remove tag from job", details: { source: "workiz" } }));
    expect(screen.getByText("Remove tag from job")).toBeInTheDocument();
    expect(screen.queryByText("Activity")).not.toBeInTheDocument();
    expect(screen.queryByText(/“/)).not.toBeInTheDocument();
    expect(screen.queryByText(/workiz_activity/)).not.toBeInTheDocument();
  });

  it("an imported change shows the sentence Workiz logged, not our field and ISO dates", () => {
    show(
      entry({
        eventType: TimelineEventType.FIELD_UPDATED,
        details: {
          field: "scheduledDate",
          oldValue: "2026-09-30T10:30:00-04:00",
          newValue: "2026-09-30T12:00:00-04:00",
          source: "workiz",
          workiz: { text: "Rescheduled job from Wed Sep 30 2026 10:30 am - 10:30 am to Wed Sep 30 2026 12:00 pm - 1:00 pm", native: false },
        },
      }),
    );
    expect(
      screen.getByText("Rescheduled job from Wed Sep 30 2026 10:30 am - 10:30 am to Wed Sep 30 2026 12:00 pm - 1:00 pm"),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Scheduled date/)).not.toBeInTheDocument();
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
    expect(screen.getByText("Client viewed invoice #O8E9NQ")).toBeInTheDocument();
    expect(screen.getByText(/#O8E9NQ/)).toBeInTheDocument();
  });

  it("an estimate view", () => {
    show(entry({ eventType: TimelineEventType.ESTIMATE_VIEWED, actorId: "client", actorName: "Client", details: { estimateId: "e1", number: "K4T9ZW-1" } }));
    expect(screen.getByText("Client viewed estimate #K4T9ZW-1")).toBeInTheDocument();
    expect(screen.getByText(/#K4T9ZW-1/)).toBeInTheDocument();
  });

  it("approving is signing: Client signed estimate; declining: Client declined estimate", () => {
    show(entry({ eventType: TimelineEventType.ESTIMATE_APPROVED, actorId: "client", actorName: "Jane Client", details: { estimateId: "e1", number: "K4T9ZW-1" } }));
    expect(screen.getByText("Client signed estimate #K4T9ZW-1")).toBeInTheDocument();
    expect(screen.getByText(/#K4T9ZW-1/)).toBeInTheDocument();
  });

  it("a decline", () => {
    show(entry({ eventType: TimelineEventType.ESTIMATE_DECLINED, actorId: "client", details: { estimateId: "e1", number: "K4T9ZW-2" } }));
    expect(screen.getByText("Client declined estimate #K4T9ZW-2")).toBeInTheDocument();
  });

  it("an invoice the client signed on the portal says Client; one signed on a tech's phone does not", () => {
    show(entry({ eventType: TimelineEventType.INVOICE_SIGNED, actorId: "client", actorName: "Josh W", details: { invoiceId: "d1", number: "O8E9NQ", signedBy: "Josh W" } }));
    expect(screen.getByText("Client signed invoice #O8E9NQ")).toBeInTheDocument();
  });

  it("a staff-collected signature", () => {
    show(entry({ eventType: TimelineEventType.INVOICE_SIGNED, actorId: "u-olha", details: { invoiceId: "d1", number: "O8E9NQ", signedBy: "Josh W" } }));
    expect(screen.getByText("Invoice signed #O8E9NQ")).toBeInTheDocument();
  });
});
