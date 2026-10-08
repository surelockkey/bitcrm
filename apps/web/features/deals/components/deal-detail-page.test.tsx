import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  ClientType,
  ContactSource,
  ContactType,
  CrmStatus,
  DealPriority,
  JobSuperStatus,
  DealStatus,
} from "@bitcrm/types";
import type { Contact, Deal } from "@bitcrm/types";

// Shared spies/state referenced from the hoisted vi.mock factories below.
const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  updateDeal: vi.fn(),
  updateContact: vi.fn(),
  createContact: vi.fn(),
  changeClient: vi.fn(),
  sendToTech: vi.fn(),
  // Per-resource so a deals-editor without contacts.edit can be simulated.
  perms: { deals: false, contacts: false },
  attachments: [] as { id: string }[],
  invoice: null as { status: string; dueDate?: string } | null,
  estimates: [] as { id: string }[],
  // Per-action, for the Actions menu and the invoice pill.
  denied: new Set<string>(),
  moveStatus: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push, replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/deals/d1",
}));

// next/link needs the App Router context; swap it for a plain anchor. The
// unsaved-changes guard listens on the document, so it must intercept these too.
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

// Permissions flip per describe: read-only proves the client link is not gated
// behind edit permissions; editable exercises the single-save flow.
vi.mock("@/features/auth/use-permissions", () => ({
  useDenied: () => () => false,
  usePermissions: () => ({
    can: (resource: string, action = "view") =>
      !mocks.denied.has(`${resource}.${action}`) &&
      (resource === "contacts" ? mocks.perms.contacts : mocks.perms.deals),
    isTechnician: false,
  }),
}));

// Catalog widgets fetch via react-query; stub them so the page renders without
// a QueryClient. None are relevant to the single-save flow.
// Everything the page asks for up front has its own test
// (deal-detail-page.loading.test.tsx); here it is simply in, so the page renders.
vi.mock("../job-page-data", () => ({ useJobPageData: () => ({ ready: true }) }));
// The note is a rich-text editor with its own tests; here it stands in as a
// plain box, because what these tests are about is the single Save.
vi.mock("./deal-notes-card", () => ({
  DealNotesCard: ({ notes, onNotesChange }: { notes: string; onNotesChange: (v: string) => void }) => (
    <textarea placeholder="What needs doing…" value={notes} onChange={(e) => onNotesChange(e.target.value)} />
  ),
}));
vi.mock("@/features/job-statuses/components/job-status-select", () => ({ JobStatusSelect: () => null }));
// The header's status picker reads the status catalog; its menu logic has its
// own tests (status-menu.test.ts).
vi.mock("@/features/job-statuses/components/job-status-menu", () => ({ JobStatusMenu: () => null }));
// "Lockout" under the Details tab comes from the active job types.
vi.mock("@/features/job-types/active-hooks", () => ({
  useActiveJobTypes: () => ({ data: [{ id: "jt-lockout", name: "Lockout", active: true }] }),
}));
vi.mock("@/features/job-types/hooks", () => ({
  useJobType: () => ({ data: undefined }),
  useJobTypes: () => ({ data: [] }),
}));
// "N estimates" under the Estimates tab.
vi.mock("@/features/estimates/hooks", () => ({
  useDealEstimates: () => ({ data: mocks.estimates }),
}));
// The rail's chat icon opens the client's SMS thread; it has its own tests.
vi.mock("@/features/clients/components/client-chat-sheet", () => ({
  ClientChatSheet: ({ open }: { open: boolean }) => (open ? <div role="dialog" aria-label="Client chat" /> : null),
}));
vi.mock("@/features/job-tags/components/job-tag-combobox", () => ({ JobTagCombobox: () => null }));
// Interactive stubs: a click drives the field's onChange so a test can prove the
// value lands in the draft (not auto-committed) and rides out on the single Save.
vi.mock("@/features/job-types/components/job-type-select", () => ({
  JobTypeSelect: ({ onChange }: { onChange: (v: string) => void }) => (
    <button type="button" onClick={() => onChange("jt-rekey")}>pick job type</button>
  ),
}));
vi.mock("@/features/job-sources/components/job-source-select", () => ({
  JobSourceSelect: ({ onChange }: { onChange: (v: string) => void }) => (
    <button type="button" onClick={() => onChange("src-web")}>pick source</button>
  ),
}));
vi.mock("@/features/external-companies/components/external-company-select", () => ({
  ExternalCompanySelect: ({ onChange }: { onChange: (v: string) => void }) => (
    <button type="button" onClick={() => onChange("ec-1")}>pick external company</button>
  ),
}));
vi.mock("@/features/business-profiles/components/business-profile-select", () => ({
  BusinessProfileSelect: ({ onChange }: { onChange: (v: string) => void }) => (
    <button type="button" onClick={() => onChange("bp-2")}>pick company</button>
  ),
}));
vi.mock("./scheduled-block", () => ({
  ScheduledBlock: ({ onChange }: { onChange: (v: { date: string; endDate: string; slot: string; allDay: boolean }) => void }) => (
    <button type="button" onClick={() => onChange({ date: "2026-09-01", endDate: "2026-09-01", slot: "", allDay: false })}>set date</button>
  ),
}));
vi.mock("@/features/service-areas/hooks", () => ({
  useResolvedServiceArea: () => ({ data: undefined }),
  // Площа на сторінці — той самий вибір зі списку, що й на створенні.
  useServiceAreas: () => ({ data: [{ id: "sa-north", name: "North GA", active: true, priority: 1 }] }),
  useEffectiveServiceArea: () => ({ submitId: "sa-north", source: "auto", area: null, resolvedArea: null, isFetching: false }),
  useNearestServiceArea: () => ({ data: undefined }),
}));
vi.mock("./assigned-techs", () => ({ AssignedTechs: () => null, TechChips: () => null }));
// The Team section assigns inline via TechSuggestions, which fetches eligible
// techs through react-query; stub it — its own tests cover the assign flow.
vi.mock("./tech-suggestions", () => ({ TechSuggestions: () => null }));
// The job page carries a strip for linking the call you're on; it queries
// telephony, which this test has no client for. Its own tests cover it.
vi.mock("@/features/calls/components/live-call-strip", () => ({
  LiveCallStrip: () => null,
}));
// Calling a client queries telephony for our numbers and their call history;
// this test has no client for either. Its own tests cover the picker.
vi.mock("@/features/telephony/components/call-client-button", () => ({
  CallClientButton: ({ to, variant }: { to: string; variant?: string }) => (
    <button type="button" aria-label={`Call ${to}`} data-variant={variant} />
  ),
}));
// The dial card queries telephony for the job code and the shared line; this
// test has neither a QueryClient nor a client. Its own tests cover it.
vi.mock("@/features/telephony/components/job-dial-card", () => ({
  JobDialCard: () => null,
}));
vi.mock("@/features/telephony/config-hooks", () => ({
  useTelephonyConfig: () => ({ data: { technicianLine: "+14045550140" } }),
}));

// One applicable custom field (scoped to all job types) so the details tab
// renders a real control we can edit; the catalog hook is stubbed to avoid a
// QueryClient/network in this focused unit test.
vi.mock("@/features/custom-fields/hooks", () => ({
  useCustomFields: () => ({
    data: [
      {
        id: "cf-gate",
        name: "Gate Code",
        type: "text",
        group: "Access",
        options: [],
        jobTypeIds: [],
        required: false,
        requiredToClose: false,
        searchable: false,
        priority: 0,
        active: true,
        createdBy: "u1",
        createdAt: "",
        updatedAt: "",
      },
    ],
  }),
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
  serviceArea: "West Valley",
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
};

// Mutable so a test can simulate an instant-action refetch (bumped updatedAt).
let dealState = deal;

vi.mock("../hooks", () => ({
  useDeal: () => ({ data: dealState, isLoading: false }),
  useDeleteDeal: () => ({ mutate: vi.fn() }),
  useUpdateDeal: () => ({ mutate: mocks.updateDeal, isPending: false }),
  useSetDealTags: () => ({ mutate: vi.fn(), isPending: false }),
  useAssignTechs: () => ({ mutate: vi.fn(), isPending: false }),
  useMoveStatus: () => ({ mutate: mocks.moveStatus }),
  useChangeDealClient: () => ({ mutate: mocks.changeClient, isPending: false }),
  useDealTimeline: () => ({
    data: { pages: [] },
    isLoading: false,
    hasNextPage: false,
    isFetchingNextPage: false,
    fetchNextPage: vi.fn(),
  }),
  useAddNote: () => ({ mutate: vi.fn(), isPending: false }),
  // "Send to tech" sits in the Team section; the card itself renders for real.
  useMarkSeenOnOpen: () => undefined,
  useSendToTech: () => ({ mutate: mocks.sendToTech, isPending: false }),
  useDealAssignments: () => ({ data: [] }),
  useUserMap: () => ({ map: new Map(), users: [], isLoading: false }),
}));

// The workspace channel default is a messaging setting; nothing here needs a
// QueryClient to answer it.
vi.mock("@/features/messaging/hooks", () => ({
  useMessagingSettings: () => ({ data: undefined }),
}));

vi.mock("@/features/clients/hooks", () => ({
  useContact: () => ({ data: contact }),
  useUpdateContact: () => ({ mutate: mocks.updateContact, isPending: false }),
  useCreateContact: () => ({ mutate: mocks.createContact, isPending: false }),
}));

// Billing tabs fetch through react-query; their own tests cover them. The
// header's invoice badge reads the by-deal invoice.
vi.mock("@/features/invoices/hooks", () => ({
  useInvoiceByDeal: () => ({ data: mocks.invoice }),
}));
// The Payments tab's caption reads the job ledger; the tab has its own tests.
vi.mock("@/features/payments/hooks", () => ({
  useDealPayments: () => ({ data: undefined }),
}));
vi.mock("@/features/payments/components/deal-payments-tab", () => ({
  DealPaymentsTab: () => <div data-testid="payments-tab" />,
  paymentsTabCaption: () => null,
}));
vi.mock("./deal-products-tab", () => ({
  DealProductsTab: () => <div data-testid="items-tab" />,
}));
vi.mock("@/features/invoices/components/deal-invoice-tab", () => ({
  DealInvoiceTab: () => <div data-testid="invoice-tab" />,
}));
vi.mock("@/features/estimates/components/deal-estimates-tab", () => ({
  DealEstimatesTab: ({ estimateId, startCreating }: { estimateId: string | null; startCreating?: boolean }) => (
    <div data-testid="estimates-tab" data-estimate={estimateId ?? ""} data-creating={startCreating ? "1" : ""} />
  ),
}));

// The attachments catalog feeds the tab-bar count; mutable so tests vary it.
vi.mock("../attachments-hooks", () => ({
  useAttachments: () => ({ data: mocks.attachments, isLoading: false }),
  useUploadAttachment: () => ({ mutate: vi.fn(), isPending: false }),
  useDeleteAttachment: () => ({ mutate: vi.fn(), isPending: false }),
}));

import { DealDetailPage } from "./deal-detail-page";
import { usePageHistoryStore } from "@/stores/page-history-store";

beforeEach(() => {
  mocks.perms.deals = false;
  mocks.perms.contacts = false;
  dealState = deal;
  mocks.attachments = [];
  mocks.invoice = null;
  mocks.estimates = [];
  mocks.denied = new Set();
  mocks.moveStatus.mockClear();
  mocks.push.mockClear();
  mocks.updateDeal.mockClear();
  mocks.updateContact.mockClear();
});

// Radix dialogs set pointer-events on <body> while open; skip the check in jsdom.
const user = () => userEvent.setup({ pointerEventsCheck: 0 });

const poInput = () => screen.getByPlaceholderText(/what needs doing/i);
const firstNameInput = () => screen.getByDisplayValue("Jane");
const saveButton = () => screen.getByRole("button", { name: "Save" });
/** Any same-origin link does for the leave guard; the client link is always on the page. */
const clientLink = () => screen.getByRole("link", { name: /view client/i });

const DIALOG_TITLE = "Leave without saving?";

function fireBeforeUnload(): Event {
  const e = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(e);
  return e;
}

// The job page scrolls as one page, the way Workiz's does: the header, the
// status/tags bar and the tabs ride up with the content instead of standing
// over a scrolling window. Only the Save bar stays put.
describe("DealDetailPage — scrolling", () => {
  it("scrolls the header, the status bar and the tabs with the content", () => {
    render(<DealDetailPage dealId="d1" />);

    const page = screen.getByTestId("job-page-scroll");
    expect(page.className).toMatch(/overflow-y-auto/);
    expect(page).toContainElement(screen.getByText("#1042"));
    expect(page).toContainElement(screen.getByRole("tab", { name: /^details$/i }));
    expect(page).toContainElement(screen.getByRole("link", { name: /view client/i }));
  });

  it("gives the details no scroll region of their own", () => {
    render(<DealDetailPage dealId="d1" />);

    const inner = screen.getByRole("link", { name: /view client/i }).closest(".overflow-y-auto");
    expect(inner).toBe(screen.getByTestId("job-page-scroll"));
  });

  it("keeps the Save bar pinned to the bottom while the page scrolls", () => {
    mocks.perms.deals = true;
    render(<DealDetailPage dealId="d1" />);

    const bar = saveButton().parentElement as HTMLElement;
    expect(bar.className).toMatch(/sticky/);
    expect(bar.className).toMatch(/bottom-0/);
  });
});

describe("DealDetailPage (read only)", () => {
  it("links from the job to the client page", () => {
    render(<DealDetailPage dealId="d1" />);

    const link = screen.getByRole("link", { name: /view client/i });
    expect(link).toHaveAttribute("href", "/contacts/c1");
  });

  /**
   * What a technician opens this page for. On a job page the call is the
   * action, not an icon tucked against the end of a phone number — and half
   * the time the number beside it is masked anyway.
   */
  it("gives the client's call the weight of a job-page action", () => {
    render(<DealDetailPage dealId="d1" />);

    expect(screen.getByRole("button", { name: /call \+14045551234/i })).toHaveAttribute(
      "data-variant",
      "prominent",
    );
  });

  it("shows the job's company in the header", () => {
    dealState = { ...deal, businessProfileId: "bp-2", businessProfileName: "KeyPro" };
    render(<DealDetailPage dealId="d1" />);
    expect(screen.getByTitle("Company")).toHaveTextContent("KeyPro");
  });

  it("upgrades the visit-history label to the job number", () => {
    usePageHistoryStore.setState({
      visits: [{ path: "/deals/d1", label: "Job" }],
    });
    render(<DealDetailPage dealId="d1" />);

    expect(usePageHistoryStore.getState().visits).toEqual([
      { path: "/deals/d1", label: "Job (1042)" },
    ]);
  });

  it("hangs the timeline on the right edge instead of a tab", () => {
    render(<DealDetailPage dealId="d1" />);

    // Exactly one "timeline" button — the hanging handle, not a tab. getByRole
    // throws if a timeline tab button were still rendered next to it.
    const handle = screen.getByRole("button", { name: /timeline/i });
    expect(handle).toHaveAttribute("aria-expanded", "false");
  });

  /**
   * Workiz puts "Send to tech" with the roster, not in a menu — handing the
   * job over is the step right after picking who does it.
   */
  it("puts 'Send to tech' in the Team section, read-only for a viewer", () => {
    render(<DealDetailPage dealId="d1" />);

    expect(screen.getByRole("button", { name: /send to tech/i })).toBeDisabled();
    expect(screen.getByTestId("send-to-tech")).toBeInTheDocument();
  });
});

describe("DealDetailPage — Workiz's two-line tabs", () => {
  it("says how many files are attached under the tab's name", () => {
    mocks.attachments = [{ id: "a1" }, { id: "a2" }, { id: "a3" }];
    render(<DealDetailPage dealId="d1" />);

    const tab = screen.getByRole("tab", { name: "Attachments" });
    expect(tab).toHaveAccessibleDescription("3 attachments");
  });

  it("writes 0 for a job without files, as Workiz does", () => {
    render(<DealDetailPage dealId="d1" />);

    expect(screen.getByRole("tab", { name: "Attachments" })).toHaveAccessibleDescription("0 attachments");
  });

  it("names the job type under Details and the items' total under Items", () => {
    mocks.perms.deals = true;
    dealState = { ...deal, totals: { subtotal: 150, discount: 0, tax: 0, total: 150, cost: 0 } };
    render(<DealDetailPage dealId="d1" />);

    expect(screen.getByRole("tab", { name: "Details" })).toHaveAccessibleDescription("Lockout");
    expect(screen.getByRole("tab", { name: "Items" })).toHaveAccessibleDescription("$150.00");
    expect(screen.getByRole("tab", { name: "Payments" })).toHaveAccessibleDescription("$150.00 balance");
    expect(screen.getByRole("tab", { name: "Estimates" })).toHaveAccessibleDescription("0 estimates");
    expect(screen.getByRole("tab", { name: "Invoice" })).toHaveAccessibleDescription("No invoice");
  });

  it("marks the open tab", async () => {
    mocks.perms.deals = true;
    render(<DealDetailPage dealId="d1" />);

    expect(screen.getByRole("tab", { name: "Details" })).toHaveAttribute("aria-selected", "true");
    await user().click(screen.getByRole("tab", { name: "Items" }));
    expect(screen.getByRole("tab", { name: "Items" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "Details" })).toHaveAttribute("aria-selected", "false");
  });
});

describe("DealDetailPage — the header, as Workiz lays it out", () => {
  it("titles the job 'Job #1042 - Jane Smith', the client's name a link to the client", () => {
    render(<DealDetailPage dealId="d1" />);

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Job #1042 - Jane Smith");
    expect(screen.getByRole("link", { name: "Jane Smith" })).toHaveAttribute("href", "/contacts/c1");
  });

  it("titles the job with the job's own name for the client when it has one", () => {
    dealState = { ...deal, clientName: { firstName: "Clinic", lastName: "" } };
    render(<DealDetailPage dealId="d1" />);

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Job #1042 - Clinic");
  });

  it("drops the old header bits: no 'You can edit', no Delete button, no status badge", () => {
    mocks.perms.deals = true;
    render(<DealDetailPage dealId="d1" />);

    expect(screen.queryByText(/you can edit/i)).toBeNull();
    expect(screen.queryByRole("button", { name: /^delete$/i })).toBeNull();
  });

  it("edits the job name inline and saves it trimmed", async () => {
    mocks.perms.deals = true;
    render(<DealDetailPage dealId="d1" />);

    await user().click(screen.getByRole("button", { name: "Edit job name" }));
    await user().type(screen.getByRole("textbox", { name: "Job name" }), "  Back gate {Enter}");

    expect(mocks.updateDeal).toHaveBeenCalledWith({ jobName: "Back gate" });
  });

  it("clears the job name with null", async () => {
    mocks.perms.deals = true;
    dealState = { ...deal, jobName: "Back gate" };
    render(<DealDetailPage dealId="d1" />);

    expect(screen.getByText("Back gate")).toBeInTheDocument();
    await user().click(screen.getByRole("button", { name: "Edit job name" }));
    await user().clear(screen.getByRole("textbox", { name: "Job name" }));
    await user().click(screen.getByRole("button", { name: "Save job name" }));

    expect(mocks.updateDeal).toHaveBeenCalledWith({ jobName: null });
  });

  it("offers no job-name pencil to a viewer", () => {
    render(<DealDetailPage dealId="d1" />);

    expect(screen.queryByRole("button", { name: "Edit job name" })).toBeNull();
  });

  it("Actions holds Job Done and Delete Job; Job Done moves the job to Done", async () => {
    mocks.perms.deals = true;
    render(<DealDetailPage dealId="d1" />);

    await user().click(screen.getByRole("button", { name: "Actions" }));
    const items = screen.getAllByRole("menuitem").map((i) => i.textContent);
    expect(items).toEqual(["Job Done", "Delete Job"]);

    await user().click(screen.getByRole("menuitem", { name: "Job Done" }));
    expect(mocks.moveStatus).toHaveBeenCalledWith({ superStatus: JobSuperStatus.DONE }, expect.anything());
  });

  it("Delete Job asks first", async () => {
    mocks.perms.deals = true;
    render(<DealDetailPage dealId="d1" />);

    await user().click(screen.getByRole("button", { name: "Actions" }));
    await user().click(screen.getByRole("menuitem", { name: "Delete Job" }));
    expect(screen.getByText("Delete job #1042?")).toBeInTheDocument();
  });

  it("keeps Delete Job from someone without deals.delete", async () => {
    mocks.perms.deals = true;
    mocks.denied = new Set(["deals.delete"]);
    render(<DealDetailPage dealId="d1" />);

    await user().click(screen.getByRole("button", { name: "Actions" }));
    expect(screen.getAllByRole("menuitem").map((i) => i.textContent)).toEqual(["Job Done"]);
  });

  it("has no Actions at all for a viewer", () => {
    render(<DealDetailPage dealId="d1" />);

    expect(screen.queryByRole("button", { name: "Actions" })).toBeNull();
  });

  it("Create Invoice opens the Invoice tab; it reads View Invoice once there is one", async () => {
    mocks.perms.deals = true;
    const { unmount } = render(<DealDetailPage dealId="d1" />);

    await user().click(screen.getByRole("button", { name: "Create Invoice" }));
    expect(screen.getByTestId("invoice-tab")).toBeInTheDocument();
    unmount();

    mocks.invoice = { status: "due" };
    render(<DealDetailPage dealId="d1" />);
    expect(screen.getByRole("button", { name: "View Invoice" })).toBeInTheDocument();
  });

  it("hides Create Invoice from someone who may not make one", () => {
    mocks.perms.deals = true;
    mocks.denied = new Set(["invoices.create"]);
    render(<DealDetailPage dealId="d1" />);

    expect(screen.queryByRole("button", { name: "Create Invoice" })).toBeNull();
  });
});

describe("DealDetailPage (editable, single save)", () => {
  beforeEach(() => {
    mocks.perms.deals = true;
    mocks.perms.contacts = true;
  });

  it("renders exactly one Save button on the page, disabled while clean", () => {
    render(<DealDetailPage dealId="d1" />);

    const saves = screen.queryAllByRole("button", { name: /save/i });
    expect(saves).toHaveLength(1);
    expect(saves[0]).toBeDisabled();
  });

  it("keeps a single Save with no per-block save buttons after address and client edits", async () => {
    const u = user();
    render(<DealDetailPage dealId="d1" />);

    // Dirty the service address and the client so any per-block dirty bars
    // would surface if they still existed.
    await u.type(screen.getByPlaceholderText("City"), "x");
    await u.type(firstNameInput(), "t");

    expect(screen.queryByRole("button", { name: /save address/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /save client/i })).toBeNull();
    expect(screen.queryAllByRole("button", { name: /save/i })).toHaveLength(1);
  });

  it("the note is directly editable — one textarea immediately, no Edit button", () => {
    render(<DealDetailPage dealId="d1" />);

    // One note, as Workiz has it: the second, dispatcher-only box was ours
    // alone and empty on every imported job.
    expect(screen.getByPlaceholderText(/what needs doing/i)).toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/internal dispatcher notes/i)).toBeNull();
    // (The header's "Edit job name" pencil is the job's name, not its note.)
    expect(screen.queryByRole("button", { name: /^edit( note)?$/i })).toBeNull();
  });

  it("saves only the changed deal keys, once, on Save", async () => {
    const u = user();
    render(<DealDetailPage dealId="d1" />);

    await u.type(poInput(), "PO-777");
    // Editing alone must not auto-commit anymore.
    expect(mocks.updateDeal).not.toHaveBeenCalled();

    await u.click(saveButton());

    expect(mocks.updateDeal).toHaveBeenCalledTimes(1);
    expect(mocks.updateDeal.mock.calls[0][0]).toEqual({ notes: "PO-777" });
    expect(mocks.updateContact).not.toHaveBeenCalled();
  });

  it("persists deal and client changes together with one Save click", async () => {
    const u = user();
    render(<DealDetailPage dealId="d1" />);

    await u.type(firstNameInput(), "t"); // Jane → Janet
    await u.type(poInput(), "PO-9");

    await u.click(saveButton());
    // Renaming the client asks whether the change is for the client too.
    await u.click(screen.getByRole("button", { name: /yes, make change/i }));

    expect(mocks.updateDeal).toHaveBeenCalledTimes(1);
    expect(mocks.updateDeal.mock.calls[0][0]).toEqual({ notes: "PO-9" });
    expect(mocks.updateContact).toHaveBeenCalledTimes(1);
    expect(mocks.updateContact.mock.calls[0][0]).toMatchObject({
      id: "c1",
      body: { firstName: "Janet" },
    });
    expect(mocks.createContact).not.toHaveBeenCalled();
  });

  it("saves the external company picked on the job", async () => {
    const u = user();
    render(<DealDetailPage dealId="d1" />);

    await u.click(screen.getByRole("button", { name: /pick external company/i }));
    await u.click(saveButton());

    expect(mocks.updateDeal).toHaveBeenCalledTimes(1);
    expect(mocks.updateDeal.mock.calls[0][0]).toEqual({ externalCompanyId: "ec-1" });
  });

  it("saves the company picked on the job", async () => {
    const u = user();
    render(<DealDetailPage dealId="d1" />);

    await u.click(screen.getByRole("button", { name: /pick company/i }));
    await u.click(saveButton());

    expect(mocks.updateDeal).toHaveBeenCalledTimes(1);
    expect(mocks.updateDeal.mock.calls[0][0]).toEqual({ businessProfileId: "bp-2" });
  });

  it("locks the number the job was created with — no editing, no removing it", () => {
    render(<DealDetailPage dealId="d1" />);

    // The first (primary) number is permanently bound to the job.
    expect(screen.getByDisplayValue("(404) 555-1234")).toBeDisabled();
    expect(
      screen.queryByRole("button", { name: /remove phone/i }),
    ).not.toBeInTheDocument();
    // Extra numbers can still be added.
    expect(screen.getByRole("button", { name: /add phone/i })).toBeInTheDocument();
  });

  it("adds a second number straight to the client — phones never prompt", async () => {
    const u = user();
    render(<DealDetailPage dealId="d1" />);

    await u.click(screen.getByRole("button", { name: /add phone/i }));
    const inputs = screen.getAllByPlaceholderText("Phone number");
    await u.type(inputs[1], "2028398283");
    await u.click(saveButton());

    expect(screen.queryByText("Change client")).not.toBeInTheDocument();
    expect(mocks.updateContact).toHaveBeenCalledTimes(1);
    expect(mocks.updateContact.mock.calls[0][0]).toMatchObject({
      id: "c1",
      body: { phones: ["+14045551234", "+12028398283"] },
    });
    expect(mocks.createContact).not.toHaveBeenCalled();
  });

  it("renaming asks 'Change client'; 'Just here' keeps the name on the job only", async () => {
    const u = user();
    render(<DealDetailPage dealId="d1" />);

    await u.type(firstNameInput(), "t"); // Jane → Janet
    await u.click(saveButton());

    expect(screen.getByText("Change client")).toBeInTheDocument();
    expect(
      screen.getByText(/also be applied to the client/i),
    ).toBeInTheDocument();
    await u.click(screen.getByRole("button", { name: /just here/i }));

    expect(mocks.updateDeal).toHaveBeenCalledTimes(1);
    expect(mocks.updateDeal.mock.calls[0][0]).toMatchObject({
      clientName: { firstName: "Janet", lastName: "Smith" },
    });
    expect(mocks.updateContact).not.toHaveBeenCalled();
    expect(mocks.createContact).not.toHaveBeenCalled();
  });

  it("'Yes, make change' applies the rename to the client record", async () => {
    const u = user();
    render(<DealDetailPage dealId="d1" />);

    await u.type(firstNameInput(), "t"); // Jane → Janet
    await u.click(saveButton());
    await u.click(screen.getByRole("button", { name: /yes, make change/i }));

    expect(mocks.updateContact).toHaveBeenCalledTimes(1);
    expect(mocks.updateContact.mock.calls[0][0]).toMatchObject({
      id: "c1",
      body: { firstName: "Janet" },
    });
    // No per-job override to write or clear on this deal.
    expect(mocks.updateDeal).not.toHaveBeenCalled();
    expect(mocks.createContact).not.toHaveBeenCalled();
  });

  /**
   * A job imported from Workiz carries its own name for the client (the
   * "Just here" pin), and the client box shows it. That is the job's name,
   * not an edit of the client record: the page opens clean, saving anything
   * else never writes the job's name into the contact, and Reset puts the
   * job's name back rather than the contact's.
   */
  describe("a job with its own name for the client", () => {
    const pinned: Deal = { ...deal, clientName: { firstName: "Clinic", lastName: "Of Weatherford" } };

    it("opens clean — Save stays off", () => {
      dealState = pinned;
      render(<DealDetailPage dealId="d1" />);

      expect(screen.getByDisplayValue("Clinic")).toBeInTheDocument();
      expect(saveButton()).toBeDisabled();
    });

    it("saving a new phone keeps the contact's own name", async () => {
      dealState = pinned;
      const u = user();
      render(<DealDetailPage dealId="d1" />);

      await u.click(screen.getByRole("button", { name: /add phone/i }));
      await u.type(screen.getAllByPlaceholderText("Phone number")[1], "2028398283");
      await u.click(saveButton());

      expect(screen.queryByText("Change client")).not.toBeInTheDocument();
      expect(mocks.updateContact).toHaveBeenCalledTimes(1);
      expect(mocks.updateContact.mock.calls[0][0].body).toMatchObject({ firstName: "Jane", lastName: "Smith" });
      expect(mocks.updateDeal).not.toHaveBeenCalled();
    });

    it("Reset puts the job's name back and leaves the page clean", async () => {
      dealState = pinned;
      const u = user();
      render(<DealDetailPage dealId="d1" />);

      await u.type(poInput(), "X-1");
      await u.click(screen.getByRole("button", { name: "Reset" }));

      expect(screen.getByDisplayValue("Clinic")).toBeInTheDocument();
      expect(saveButton()).toBeDisabled();
    });
  });

  it("only asks about the client when the client itself changed", async () => {
    const u = user();
    render(<DealDetailPage dealId="d1" />);

    await u.type(poInput(), "PO-9");
    await u.click(saveButton());

    expect(screen.queryByText(/before saving the job/i)).not.toBeInTheDocument();
    expect(mocks.updateDeal).toHaveBeenCalledTimes(1);
  });

  it("holds service-area, schedule and select edits in the draft until Save (no auto-commit)", async () => {
    const u = user();
    render(<DealDetailPage dealId="d1" />);

    // Площа — вибір зі списку, той самий, що й на створенні роботи.
    await u.click(screen.getByRole("combobox", { name: /service area/i }));
    await u.click(screen.getByRole("option", { name: "North GA" }));
    await u.click(screen.getByRole("button", { name: /set date/i }));
    await u.click(screen.getByRole("button", { name: /pick job type/i }));
    await u.click(screen.getByRole("button", { name: /pick source/i }));

    // None of these fields may commit on their own — that's the whole point.
    expect(mocks.updateDeal).not.toHaveBeenCalled();

    await u.click(saveButton());
    expect(mocks.updateDeal).toHaveBeenCalledTimes(1);
    expect(mocks.updateDeal.mock.calls[0][0]).toEqual({
      // Ідентифікатор, а не назва: назву сервер бере з довідника.
      serviceAreaId: "sa-north",
      scheduledDate: "2026-09-01",
      scheduledEndDate: "2026-09-01",
      jobTypeId: "jt-rekey",
      sourceId: "src-web",
    });
  });

  it("doesn't write the contact when a deals-only user (no contacts.edit) edits the service address", async () => {
    const u = user();
    mocks.perms.contacts = false; // has deals.edit, lacks contacts.edit
    render(<DealDetailPage dealId="d1" />);

    // A new service address would otherwise be appended to the client's saved
    // list — a contact write this user isn't allowed to make.
    await u.type(screen.getByPlaceholderText("City"), "burg");
    await u.click(saveButton());

    expect(mocks.updateDeal).toHaveBeenCalledTimes(1);
    expect(mocks.updateDeal.mock.calls[0][0]).toHaveProperty("address");
    expect(mocks.updateContact).not.toHaveBeenCalled();
  });

  it("splits custom fields into per-group cards instead of one Custom fields block", () => {
    render(<DealDetailPage dealId="d1" />);

    // The field's group is the card title; the monolithic block is gone.
    expect(screen.getByText("Access")).toBeInTheDocument();
    expect(screen.queryByText(/^Custom fields$/)).toBeNull();
  });

  it("marks the page dirty when an applicable custom field is edited and sends it on Save", async () => {
    const u = user();
    render(<DealDetailPage dealId="d1" />);

    const gate = screen.getByLabelText("Gate Code");
    expect(saveButton()).toBeDisabled();

    await u.type(gate, "4417");
    // Editing a custom field must not auto-commit — it rides the single Save.
    expect(mocks.updateDeal).not.toHaveBeenCalled();
    expect(saveButton()).toBeEnabled();

    await u.click(saveButton());

    expect(mocks.updateDeal).toHaveBeenCalledTimes(1);
    expect(mocks.updateDeal.mock.calls[0][0]).toEqual({ customFields: { "cf-gate": "4417" } });
  });

  it("keeps unsaved draft edits when an instant action refetches the deal (updatedAt bump)", async () => {
    const u = user();
    const { rerender } = render(<DealDetailPage dealId="d1" />);

    await u.type(poInput(), "PO-KEEP");
    expect(saveButton()).toBeEnabled();

    // A status / tag / assign change invalidates useDeal; the refetch returns the
    // same deal with a bumped updatedAt. That must not wipe the unsaved edit.
    dealState = { ...deal, updatedAt: "2026-07-31T12:00:00Z" };
    rerender(<DealDetailPage dealId="d1" />);

    expect(poInput()).toHaveValue("PO-KEEP");
    expect(saveButton()).toBeEnabled();
  });

  it("warns before leaving via a link while dirty — Stay keeps, Leave navigates", async () => {
    const u = user();
    render(<DealDetailPage dealId="d1" />);

    await u.type(poInput(), "PO-1");

    await u.click(clientLink());
    expect(await screen.findByText(DIALOG_TITLE)).toBeInTheDocument();

    await u.click(screen.getByRole("button", { name: "Stay" }));
    await waitFor(() => expect(screen.queryByText(DIALOG_TITLE)).toBeNull());
    expect(mocks.push).not.toHaveBeenCalled();

    await u.click(clientLink());
    expect(await screen.findByText(DIALOG_TITLE)).toBeInTheDocument();

    await u.click(screen.getByRole("button", { name: "Leave" }));
    expect(mocks.push).toHaveBeenCalledWith("/contacts/c1");
  });

  it("does not warn on a link once edits are reset", async () => {
    const u = user();
    render(<DealDetailPage dealId="d1" />);

    await u.type(poInput(), "X-1");
    expect(saveButton()).toBeEnabled();

    await u.click(screen.getByRole("button", { name: "Reset" }));
    expect(poInput()).toHaveValue("");
    expect(saveButton()).toBeDisabled();

    await u.click(clientLink());
    expect(screen.queryByText(DIALOG_TITLE)).toBeNull();
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it("blocks beforeunload only while dirty", async () => {
    const u = user();
    render(<DealDetailPage dealId="d1" />);

    expect(fireBeforeUnload().defaultPrevented).toBe(false);

    await u.type(poInput(), "PO-2");
    expect(fireBeforeUnload().defaultPrevented).toBe(true);
  });
});

describe("DealDetailPage — billing tabs and deep links", () => {
  it("`?estimate=new` opens the Estimates tab with a new estimate started, not an estimate called \"new\"", () => {
    mocks.perms.deals = true;
    window.history.replaceState(null, "", "/deals/d1?tab=estimates&estimate=new");
    render(<DealDetailPage dealId="d1" initialTab="estimates" initialEstimateId="new" />);

    const tab = screen.getByTestId("estimates-tab");
    expect(tab).toHaveAttribute("data-estimate", "");
    expect(tab).toHaveAttribute("data-creating", "1");
  });

  it("opens the tab named in the URL and keeps the URL in sync", async () => {
    mocks.perms.deals = true;
    window.history.replaceState(null, "", "/deals/d1?tab=estimates&estimate=e1");
    render(<DealDetailPage dealId="d1" initialTab="estimates" initialEstimateId="e1" />);

    expect(screen.getByTestId("estimates-tab")).toHaveAttribute("data-estimate", "e1");

    await user().click(screen.getByRole("tab", { name: /^invoice$/i }));
    expect(screen.getByTestId("invoice-tab")).toBeInTheDocument();
    expect(`${window.location.pathname}${window.location.search}`).toBe("/deals/d1?tab=invoice");

    await user().click(screen.getByRole("tab", { name: /^details$/i }));
    expect(`${window.location.pathname}${window.location.search}`).toBe("/deals/d1");
  });

  it("falls back to Details when the linked tab isn't permitted", () => {
    mocks.perms.deals = false;
    render(<DealDetailPage dealId="d1" initialTab="invoice" />);
    expect(screen.queryByRole("tab", { name: /^invoice$/i })).toBeNull();
    expect(screen.queryByTestId("invoice-tab")).toBeNull();
  });

  // The header's "Invoice: Overdue" badge moved under the Invoice tab, in the
  // grey line Workiz gives every tab.
  it("shows the invoice status under the Invoice tab", () => {
    mocks.perms.deals = true;
    mocks.invoice = { status: "overdue" };
    render(<DealDetailPage dealId="d1" />);
    expect(screen.getByRole("tab", { name: "Invoice" })).toHaveAccessibleDescription("Overdue");
  });
});
