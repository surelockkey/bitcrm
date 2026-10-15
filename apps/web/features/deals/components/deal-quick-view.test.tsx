import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  ClientType,
  ContactSource,
  ContactType,
  CrmStatus,
  DealPriority,
  JobSuperStatus,
  DealStatus,
  TimelineEventType,
} from "@bitcrm/types";
import type { Contact, Deal, DealProduct } from "@bitcrm/types";

// next/link needs the App Router context to render; swap it for a plain anchor
// so this stays a focused unit test.
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

// The Sheet is a Radix portal/animation wrapper; render its children directly.
vi.mock("@/components/ui/sheet", () => ({
  Sheet: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SheetContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SheetHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SheetTitle: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SheetClose: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

const perms = vi.hoisted(() => ({ can: vi.fn<(area: string, action?: string) => boolean>(() => true) }));
vi.mock("@/features/auth/use-permissions", () => ({
  useDenied: () => () => false,
  usePermissions: () => ({ can: perms.can }),
}));

vi.mock("@/features/job-types/lib", () => ({
  useJobTypesLoading: () => false,
  useJobTypeName: () => (id: string | undefined) => id ?? "—",
}));

// Catalog widgets fetch via react-query; stub them so the drawer renders
// without a QueryClient.
vi.mock("@/features/job-tags/components/job-tag-chips", () => ({ JobTagChips: () => null }));
vi.mock("@/features/job-tags/components/job-tag-combobox", () => ({ JobTagCombobox: () => <div data-testid="tags" /> }));
vi.mock("@/features/job-statuses/components/job-status-menu", () => ({ JobStatusMenu: () => <div data-testid="status" /> }));
vi.mock("./workiz", () => ({
  WzTeamSelect: ({ value, disabled }: { value: string[]; disabled?: boolean }) => (
    <input aria-label="Assign tech" readOnly disabled={disabled} value={value.join(",")} />
  ),
}));
// The custom-field renderer is the Workiz one from New Job; here it only
// needs to show whether it is editable and to hand back a change.
vi.mock("@/features/custom-fields/components/wz-custom-fields", () => ({
  WzCustomFields: ({
    value,
    onChange,
    disabled,
  }: {
    value: Record<string, unknown>;
    onChange: (v: Record<string, unknown>) => void;
    disabled?: boolean;
  }) => (
    <div>
      <input aria-label="Gate code" disabled={disabled} value={String(value["cf-gate"] ?? "")} onChange={(e) => onChange({ ...value, "cf-gate": e.target.value })} />
    </div>
  ),
}));
vi.mock("./job-note-editor", () => ({
  JobNoteEditor: ({ value, onChange, editable, ariaLabel }: { value: string; onChange: (s: string) => void; editable?: boolean; ariaLabel?: string }) =>
    editable ? <textarea aria-label={ariaLabel ?? "Notes"} value={value} onChange={(e) => onChange(e.target.value)} /> : <div>{value}</div>,
}));
const qv = vi.hoisted(() => ({
  fields: [] as unknown[],
  deal: null as unknown,
  products: [] as unknown[],
  totals: null as unknown,
  notes: [] as unknown[],
}));
vi.mock("@/features/custom-fields/hooks", () => ({ useCustomFields: () => ({ data: qv.fields }) }));
// The zone a visit was booked in: the job's own, else its area's (one Texas area here).
vi.mock("@/features/service-areas/hooks", async () => {
  const { jobZoneResolver } = await import("@/features/service-areas/lib");
  return { useJobZoneOf: () => jobZoneResolver([{ id: "sa-tx", timezone: "America/Chicago" }]) };
});
// Calling the client goes through the masked bridge, which queries telephony
// for the workspace's numbers; the button has its own tests.
// Texting the client opens the job page's own chat panel; it has its own tests.
vi.mock("@/features/clients/components/client-chat-sheet", () => ({
  ClientChatSheet: ({ open, contactId, name }: { open: boolean; contactId: string; name: string }) =>
    open ? <div data-testid="client-chat" data-contact={contactId}>{name}</div> : null,
}));
vi.mock("@/features/telephony/components/call-client-button", () => ({
  CallClientButton: ({ to, variant }: { to: string; variant?: string }) => (
    <button type="button" aria-label={`Call ${to}`} data-variant={variant} />
  ),
}));

const contact: Contact = {
  id: "c1",
  firstName: "Jane",
  lastName: "Smith",
  phones: ["+14045551234"],
  emails: [],
  addresses: [],
  type: ContactType.RESIDENTIAL,
  source: ContactSource.PHONE_CALL,
  status: CrmStatus.ACTIVE,
  createdBy: "u1",
  createdAt: "",
  updatedAt: "",
};

const deal: Deal = {
  id: "d1",
  dealNumber: "1042",
  contactId: "c1",
  clientType: ClientType.RESIDENTIAL,
  serviceArea: "Phoenix",
  address: { street: "1 Main", city: "Phoenix", state: "AZ", zip: "85001" },
  jobTypeId: "jt-lockout",
  superStatus: JobSuperStatus.SUBMITTED,
  assignedDispatcherId: "u1",
  priority: DealPriority.NORMAL,
  assignedTechIds: [],
  tagIds: [],
  status: DealStatus.ACTIVE,
  createdBy: "u1",
  createdAt: "",
  updatedAt: "",
  businessProfileId: "bp-2",
  businessProfileName: "KeyPro",
  itemCount: 0,
};

const mutations = vi.hoisted(() => ({
  update: vi.fn(),
  addNote: vi.fn(),
  assign: vi.fn(),
  setTags: vi.fn(),
  moveStatus: vi.fn(),
}));

vi.mock("@/features/clients/hooks", () => ({
  useContact: (id: string) => ({ data: id === contact.id ? contact : undefined, isLoading: false, isPending: false, isSuccess: true }),
}));
vi.mock("../hooks", () => ({
  useDeal: () => ({ data: qv.deal ?? deal, isLoading: false, isPending: false }),
  useDealProducts: () => ({ data: qv.products, isPending: false }),
  useDealTotals: () => ({ data: qv.totals, isPending: false }),
  useDealTimeline: () => ({
    data: { pages: [{ data: qv.notes, pagination: {} }] },
    isPending: false,
    hasNextPage: false,
    fetchNextPage: vi.fn(),
  }),
  useUserMap: () => ({ map: new Map(), isLoading: false }),
  useUpdateDeal: () => ({ mutate: mutations.update, isPending: false }),
  useAddNote: () => ({ mutate: mutations.addNote, isPending: false }),
  useAssignTechs: () => ({ mutate: mutations.assign, isPending: false }),
  useSetDealTags: () => ({ mutate: mutations.setTags }),
  useMoveStatus: () => ({ mutate: mutations.moveStatus }),
}));

import { DealQuickView } from "./deal-quick-view";

const open = () => render(<DealQuickView dealId="d1" open onOpenChange={() => {}} />);

describe("DealQuickView", () => {
  beforeEach(() => {
    perms.can.mockImplementation(() => true);
    qv.deal = null;
    qv.products = [];
    qv.totals = null;
    qv.notes = [];
    qv.fields = [];
    perms.can.mockReturnValue(true);
    Object.values(mutations).forEach((m) => m.mockReset());
  });

  /**
   * Peeking at a job is usually a prelude to ringing the client, so the call
   * is the primary action on the card rather than one more glyph in a row of
   * them.
   */
  it("makes calling the client the card's obvious action", () => {
    open();
    expect(screen.getByRole("button", { name: /call \+14045551234/i })).toHaveAttribute("data-variant", "prominent");
  });

  // Workiz's quick view has call AND message at the client's right edge; ours
  // had call and, only for a client with an email, mail — so most jobs gave
  // no way to write to the client (owner, 2026-10-15).
  it("offers to message the client on every job with one — no email needed — and opens the chat", async () => {
    open();
    await userEvent.click(screen.getByRole("button", { name: "Message client" }));
    expect(screen.getByTestId("client-chat")).toHaveAttribute("data-contact", "c1");
  });

  it("offers no message button to someone who may not send messages", () => {
    perms.can.mockImplementation((area: string, action?: string) => !(area === "messages" && action === "send"));
    open();
    expect(screen.queryByRole("button", { name: "Message client" })).toBeNull();
  });

  it("links the client name to the contact page so you can jump from the job to the client", () => {
    open();
    expect(screen.getByRole("link", { name: "Jane Smith" })).toHaveAttribute("href", "/contacts/c1");
  });

  it("shows the job's company", () => {
    open();
    expect(screen.getByText("Company")).toBeInTheDocument();
    expect(screen.getByText("KeyPro")).toBeInTheDocument();
  });

  /** Workiz's pane (quickview_wz_open): "Job ID: …", open-in-new-tab, Details · Custom fields · Items. */
  it("is Workiz's pane: the Job ID, the job in a new tab, and its three tabs", () => {
    open();
    expect(screen.getByText("Job ID: 1042")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open full job" })).toHaveAttribute("href", "/deals/d1");
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual(["Details", "Custom fields", "Items"]);
  });

  /**
   * Audit L18: the drawer said "Nov 16 · 15:30-15:30" — 24-hour, start equal
   * to end — where the list says "Mon Nov 16, 2026 04:30 pm". It reads like
   * the list: the account's clock, then the place and its own.
   */
  it("reads the visit the way the list does — each clock naming its zone", () => {
    qv.deal = { ...deal, scheduledDate: "2026-11-16", scheduledTimeSlot: "15:30-15:30", jobTimezone: "America/Chicago" };
    open();
    expect(screen.getByText("Mon Nov 16, 2026 04:30 pm EST")).toBeInTheDocument();
    expect(screen.getByText("Phoenix: Mon Nov 16, 2026 03:30 pm CST")).toBeInTheDocument();
    expect(screen.queryByText(/15:30-15:30/)).toBeNull();
  });

  it("converts a visit booked on its service area's clock, labelled", () => {
    qv.deal = { ...deal, scheduledDate: "2026-10-08", scheduledTimeSlot: "08:00-09:00", jobTimezone: undefined, serviceAreaId: "sa-tx" };
    open();
    expect(screen.getByText("Thu Oct 08, 2026 09:00 am EDT")).toBeInTheDocument();
    expect(screen.getByText("Phoenix: Thu Oct 08, 2026 08:00 am CDT")).toBeInTheDocument();
  });

  it("says so when the job is unscheduled, as Workiz does", () => {
    open();
    expect(screen.getByText("This job is unscheduled")).toBeInTheDocument();
  });

  /** quickview_wz_edit_schedule: the pencil opens Starts / At, Ends / At, All day, Cancel / Save. */
  it("edits the schedule in place and saves the visit", async () => {
    const user = userEvent.setup();
    qv.deal = { ...deal, scheduledDate: "2026-10-08", scheduledEndDate: "2026-10-08", scheduledTimeSlot: "08:00-09:00", jobTimezone: "America/New_York" };
    open();
    await user.click(screen.getByRole("button", { name: "Edit schedule" }));
    expect(screen.getByLabelText("Starts")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(mutations.update).toHaveBeenCalledWith(
      expect.objectContaining({ scheduledDate: "2026-10-08", scheduledEndDate: "2026-10-08", scheduledTimeSlot: "08:00-09:00", allDay: false }),
      expect.anything(),
    );
  });

  it("assigns the team from the pane", () => {
    open();
    expect(screen.getByRole("textbox", { name: "Assign tech" })).not.toBeDisabled();
  });

  /** quickview_wz_edit_description: the pencil turns the text into the editor. */
  it("edits the description in place", async () => {
    const user = userEvent.setup();
    qv.deal = { ...deal, notes: "Rekey the back door" };
    open();
    expect(screen.getByText("Rekey the back door")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Edit description" }));
    const box = screen.getByRole("textbox", { name: "Description" });
    await user.clear(box);
    await user.type(box, "Rekey both doors");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(mutations.update).toHaveBeenCalledWith({ notes: "Rekey both doors" }, expect.anything());
  });

  /** quickview_wz_add_note: Notes folds open, "+" is Add note, the box saves a job note. */
  it("lets a note be left from the pane", async () => {
    const user = userEvent.setup();
    qv.notes = [
      { id: "n1", dealId: "d1", eventType: TimelineEventType.NOTE_ADDED, actorId: "u1", actorName: "Sam", timestamp: "2026-10-14T12:00:00Z", details: {}, note: "Client called back" },
      { id: "f1", dealId: "d1", eventType: TimelineEventType.FIELD_UPDATED, actorId: "u1", actorName: "Sam", timestamp: "2026-10-14T12:00:00Z", details: { field: "notes" } },
    ];
    open();
    await user.click(screen.getByRole("button", { name: "Notes" }));
    expect(screen.getByText("Client called back")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Add note" }));
    await user.type(screen.getByRole("textbox", { name: "Add note" }), "Gate code 1234");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(mutations.addNote).toHaveBeenCalledWith("Gate code 1234", expect.anything());
  });

  describe("Finance", () => {
    const finance = async (user: ReturnType<typeof userEvent.setup>) => {
      await user.click(screen.getByRole("button", { name: "Finance" }));
    };

    /** quickview_wz_details_expanded_bottom: Total · Due (read-only) · Tech Cost · Company Cost. */
    it("types the total of a job without items and saves it on leaving the box", async () => {
      const user = userEvent.setup();
      qv.totals = { total: 0, amountPaid: 0, balanceDue: 0 };
      open();
      await finance(user);
      const total = screen.getByRole("textbox", { name: "Total" });
      expect(total).not.toBeDisabled();
      expect(screen.getByRole("textbox", { name: "Due" })).toBeDisabled();
      await user.clear(total);
      await user.type(total, "150");
      await user.tab();
      expect(mutations.update).toHaveBeenCalledWith({ total: 150 }, expect.anything());
    });

    it("shows the items' total read-only once the job has lines", async () => {
      const user = userEvent.setup();
      qv.deal = { ...deal, itemCount: 2, totals: { subtotal: 286.4, discount: 0, tax: 0, total: 286.4, cost: 0 } };
      qv.totals = { total: 286.4, amountPaid: 100, balanceDue: 186.4 };
      open();
      await finance(user);
      expect(screen.getByRole("textbox", { name: "Total" })).toBeDisabled();
      expect(screen.getByRole("textbox", { name: "Total" })).toHaveValue("286.40");
      expect(screen.getByRole("textbox", { name: "Due" })).toHaveValue("186.40");
    });

    it("saves Tech Cost and Company Cost as they are left", async () => {
      const user = userEvent.setup();
      qv.deal = { ...deal, techCost: 10 };
      open();
      await finance(user);
      const tech = screen.getByRole("textbox", { name: "Tech Cost" });
      expect(tech).toHaveValue("10.00");
      await user.clear(tech);
      await user.type(tech, "82.74");
      await user.tab();
      expect(mutations.update).toHaveBeenCalledWith({ techCost: 82.74 }, expect.anything());
      const company = screen.getByRole("textbox", { name: "Company Cost" });
      await user.type(company, "5");
      await user.tab();
      expect(mutations.update).toHaveBeenCalledWith({ companyCost: 5 }, expect.anything());
    });

    it("leaving a box unchanged saves nothing", async () => {
      const user = userEvent.setup();
      qv.deal = { ...deal, techCost: 10 };
      open();
      await finance(user);
      await user.click(screen.getByRole("textbox", { name: "Tech Cost" }));
      await user.tab();
      expect(mutations.update).not.toHaveBeenCalled();
    });

    it("is kept from those who may not see money", async () => {
      perms.can.mockImplementation((area: string) => area !== "financials");
      open();
      expect(screen.queryByRole("button", { name: "Finance" })).toBeNull();
    });
  });

  /** quickview_wz_tab_custom_fields: every field editable, saved from the pane. */
  it("edits the custom fields on their tab and saves them", async () => {
    const user = userEvent.setup();
    qv.fields = [{ id: "cf-gate", name: "Gate code", type: "text", group: "Access", options: [], jobTypeIds: [], required: false, requiredToClose: false, searchable: false, priority: 0, active: true, createdBy: "u1", createdAt: "", updatedAt: "" }];
    open();
    await user.click(screen.getByRole("tab", { name: "Custom fields" }));
    const gate = screen.getByRole("textbox", { name: "Gate code" });
    expect(gate).not.toBeDisabled();
    await user.type(gate, "1234");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(mutations.update).toHaveBeenCalledWith({ customFields: { "cf-gate": "1234" } }, expect.anything());
  });

  describe("Items tab", () => {
    /** quickview_wz_tab_items: "No items", "You can add items from the job page only.", the link. */
    it("says there are none and points at the job page", async () => {
      const user = userEvent.setup();
      open();
      await user.click(screen.getByRole("tab", { name: "Items" }));
      expect(screen.getByText("No items")).toBeInTheDocument();
      expect(screen.getByText("You can add items from the job page only.")).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "Add items from the job page" })).toHaveAttribute("href", expect.stringMatching(/\/deals\/d1.*items/));
    });

    /** quickview_wz_items_job_ANQ7B7_items: name, "1 x $45.00 each", the line total, TAXABLE, view only. */
    it("lists the lines read-only", async () => {
      const user = userEvent.setup();
      const line: DealProduct = { lineId: "l1", productId: "p1", name: "Service Call", sku: "", quantity: 2, costCompany: 0, costForTech: 0, priceClient: 45, taxable: true, addedBy: "u1", addedAt: "" };
      qv.products = [line];
      open();
      await user.click(screen.getByRole("tab", { name: "Items" }));
      const row = screen.getByText("Service Call").closest("li")!;
      expect(within(row).getByText("2 x $45.00 each")).toBeInTheDocument();
      expect(within(row).getByText("$90.00")).toBeInTheDocument();
      expect(within(row).getByText("TAXABLE")).toBeInTheDocument();
      expect(screen.getByText("This is view only. To add an item you will be redirected to the job page.")).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "Go to Items page" })).toBeInTheDocument();
    });
  });
});
