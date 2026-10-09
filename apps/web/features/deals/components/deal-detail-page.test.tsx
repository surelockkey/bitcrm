import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
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
  invoice: null as { id: string; status: string; dueDate?: string } | null,
  createInvoice: vi.fn(),
  estimates: [] as { id: string }[],
  // Per-action, for the Actions menu and the invoice pill.
  denied: new Set<string>(),
  moveStatus: vi.fn(),
  setTags: vi.fn(),
  tagPicker: null as null | { value: string[]; onChange: (ids: string[]) => void },
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
vi.mock("@/features/job-tags/components/job-tag-combobox", () => ({
  JobTagCombobox: (p: { value: string[]; onChange: (ids: string[]) => void }) => {
    mocks.tagPicker = p;
    return <div data-testid="job-tags">{p.value.join(",")}</div>;
  },
}));
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
  useSetDealTags: () => ({ mutate: mocks.setTags, isPending: false }),
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
  // The rail's Messages filter: the job's texts.
  useMessagesByJob: () => ({ data: { pages: [{ data: [], pagination: {} }] }, isLoading: false, hasNextPage: false }),
}));

vi.mock("@/features/clients/hooks", () => ({
  useContact: () => ({ data: contact }),
  useUpdateContact: () => ({ mutate: mocks.updateContact, isPending: false }),
  useCreateContact: () => ({ mutate: mocks.createContact, isPending: false }),
}));

// Billing tabs fetch through react-query; their own tests cover them. The
// header's invoice pill reads the by-deal invoice, and makes it.
vi.mock("@/features/invoices/hooks", () => ({
  useInvoiceByDeal: () => ({ data: mocks.invoice }),
  useCreateInvoice: () => ({ mutate: mocks.createInvoice, isPending: false }),
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
  mocks.createInvoice.mockReset();
  mocks.estimates = [];
  mocks.denied = new Set();
  mocks.moveStatus.mockClear();
  mocks.push.mockClear();
  mocks.updateDeal.mockClear();
  mocks.updateContact.mockClear();
});

// Radix dialogs set pointer-events on <body> while open; skip the check in jsdom.
const user = () => userEvent.setup({ pointerEventsCheck: 0 });

/** The Details tab's form has its own tests (deal-details-tab.test.tsx); here it is a stand-in. */
const detailsTab = () => screen.getByTestId("details-tab");

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
    expect(page).toContainElement(detailsTab());
  });

  it("gives the details no scroll region of their own", () => {
    render(<DealDetailPage dealId="d1" />);

    expect(detailsTab().closest(".overflow-y-auto")).toBe(screen.getByTestId("job-page-scroll"));
  });
});

describe("DealDetailPage (read only)", () => {
  /** Workiz links the client from the title only; the Client section has no "View client". */
  it("links from the job to the client page", () => {
    render(<DealDetailPage dealId="d1" />);

    expect(screen.getByRole("link", { name: "Jane Smith" })).toHaveAttribute("href", "/contacts/c1");
  });

  it("hands the Details tab the job, read only for a viewer", () => {
    render(<DealDetailPage dealId="d1" />);

    expect(detailsTab()).toHaveAttribute("data-deal", "d1");
    expect(detailsTab()).toHaveAttribute("data-can-edit", "false");
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
  });

  // job_invoice_route_wz_XYB3JT_details: Details · Items · Payments · Estimates ·
  // Attachments (· Workiz's Tasks, Genius, Equipment, Checklists) — no Invoice.
  it("has no Invoice tab, as Workiz's job page has none", () => {
    mocks.perms.deals = true;
    mocks.invoice = { id: "d1", status: "overdue" };
    render(<DealDetailPage dealId="d1" />);

    expect(screen.getAllByRole("tab").map((t) => t.getAttribute("aria-label"))).toEqual([
      "Details", "Items", "Payments", "Estimates", "Attachments",
    ]);
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

  // Workiz prints a job's tags in catalog order (the picker's workiz dress
  // does that); the header hands it the job's own list, and a tag added goes
  // on the end of what the job keeps.
  it("hands the picker the job's tags as kept, and a tag added goes on the end", () => {
    mocks.perms.deals = true;
    dealState = { ...deal, tagIds: ["t-old", "t-mid", "t-new"] };
    render(<DealDetailPage dealId="d1" />);

    expect(screen.getByTestId("job-tags")).toHaveTextContent("t-old,t-mid,t-new");
    mocks.tagPicker!.onChange(["t-new", "t-mid", "t-old", "t-added"]);
    expect(mocks.setTags).toHaveBeenCalledWith(["t-old", "t-mid", "t-new", "t-added"], expect.anything());
  });

  // J9: Workiz's View Work Order, for a job a work order authorized.
  it("Actions offers View Work Order for a job a work order authorized, opening that work order", async () => {
    mocks.perms.deals = true;
    dealState = { ...deal, workOrderId: "wo-7" };
    render(<DealDetailPage dealId="d1" />);

    await user().click(screen.getByRole("button", { name: "Actions" }));
    expect(screen.getAllByRole("menuitem").map((i) => i.textContent)).toEqual(["Job Done", "View Work Order", "Delete Job"]);
    await user().click(screen.getByRole("menuitem", { name: "View Work Order" }));
    expect(mocks.push).toHaveBeenCalledWith("/work-orders?id=wo-7");
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

  // Workiz's bundle: createJobInvoice, then history.push("invoice/<uuid>").
  it("Create Invoice makes the job's invoice and then opens it on its own page", async () => {
    mocks.perms.deals = true;
    dealState = { ...deal, itemCount: 2 };
    mocks.createInvoice.mockImplementation((_id: string, opts?: { onSuccess?: (inv: { id: string }) => void }) =>
      opts?.onSuccess?.({ id: "d1" }),
    );
    render(<DealDetailPage dealId="d1" />);

    await user().click(screen.getByRole("button", { name: "Create Invoice" }));
    expect(mocks.createInvoice).toHaveBeenCalledWith("d1", expect.anything());
    expect(mocks.push).toHaveBeenCalledWith("/invoices/d1");
  });

  // job_invoice_route_wz_XYB3JT_view_invoice_opened: same tab, /root/invoice/XYB3JT.
  it("View Invoice opens the job's invoice on its own page", async () => {
    mocks.perms.deals = true;
    mocks.invoice = { id: "d1", status: "due" };
    render(<DealDetailPage dealId="d1" />);

    await user().click(screen.getByRole("button", { name: "View Invoice" }));
    expect(mocks.push).toHaveBeenCalledWith("/invoices/d1");
    expect(mocks.createInvoice).not.toHaveBeenCalled();
  });

  it("keeps Create Invoice from a job with no items, saying why", async () => {
    mocks.perms.deals = true;
    dealState = { ...deal, itemCount: 0 };
    render(<DealDetailPage dealId="d1" />);

    const pill = screen.getByRole("button", { name: "Create Invoice" });
    expect(pill).toHaveAttribute("aria-disabled", "true");
    expect(pill).toHaveAccessibleDescription("Add at least one item to the job first");
    await user().click(pill);
    expect(mocks.createInvoice).not.toHaveBeenCalled();
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it("hides Create Invoice from someone who may not make one", () => {
    mocks.perms.deals = true;
    mocks.denied = new Set(["invoices.create"]);
    render(<DealDetailPage dealId="d1" />);

    expect(screen.queryByRole("button", { name: "Create Invoice" })).toBeNull();
  });
});

// The form body — Client, Schedule, Job, Team, the custom fields and the one
// Save — is DetailsTab, tested on its own in deal-details-tab.test.tsx. Here
// it stands in, so these tests are about the page around it.
vi.mock("./deal-details-tab", () => ({
  DetailsTab: ({ deal: d, canEdit }: { deal: Deal; canEdit: boolean }) => (
    <div data-testid="details-tab" data-deal={d.id} data-can-edit={String(canEdit)} />
  ),
}));

describe("DealDetailPage (editable)", () => {
  beforeEach(() => {
    mocks.perms.deals = true;
    mocks.perms.contacts = true;
  });

  it("hands the Details tab the right to edit", () => {
    render(<DealDetailPage dealId="d1" />);

    expect(detailsTab()).toHaveAttribute("data-can-edit", "true");
  });

  /** Unsaved edits live in the Details tab's draft; a hop to Items must not drop them. */
  it("keeps the Details tab mounted, just hidden, while another tab is open", async () => {
    render(<DealDetailPage dealId="d1" />);

    await user().click(screen.getByRole("tab", { name: "Items" }));

    expect(detailsTab()).toBeInTheDocument();
    expect(detailsTab().closest("[role=tabpanel]")).toHaveClass("hidden");
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

    await user().click(screen.getByRole("tab", { name: /^attachments$/i }));
    expect(`${window.location.pathname}${window.location.search}`).toBe("/deals/d1?tab=attachments");

    await user().click(screen.getByRole("tab", { name: /^details$/i }));
    expect(`${window.location.pathname}${window.location.search}`).toBe("/deals/d1");
  });

  it("falls back to Details when the linked tab isn't permitted", () => {
    mocks.perms.deals = false;
    render(<DealDetailPage dealId="d1" initialTab="estimates" />);
    expect(screen.queryByRole("tab", { name: /^estimates$/i })).toBeNull();
    expect(screen.queryByTestId("estimates-tab")).toBeNull();
    expect(screen.getByRole("tab", { name: /^details$/i })).toHaveAttribute("aria-selected", "true");
  });
});
