import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
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
  // Per-resource so a deals-editor without contacts.edit can be simulated.
  perms: { deals: false, contacts: false },
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
  usePermissions: () => ({
    can: (resource: string) => (resource === "contacts" ? mocks.perms.contacts : mocks.perms.deals),
    isTechnician: false,
  }),
}));

// Catalog widgets fetch via react-query; stub them so the page renders without
// a QueryClient. None are relevant to the single-save flow.
vi.mock("@/features/job-statuses/components/job-status-select", () => ({ JobStatusSelect: () => null }));
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
vi.mock("./schedule-field", () => ({
  ScheduleField: ({ onDate }: { onDate: (d: string | undefined) => void }) => (
    <button type="button" onClick={() => onDate("2026-09-01")}>set date</button>
  ),
}));
vi.mock("./assigned-techs", () => ({ AssignedTechs: () => null, TechChips: () => null }));

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
  useMoveStatus: () => ({ mutate: vi.fn() }),
  useDealTimeline: () => ({
    data: { pages: [] },
    isLoading: false,
    hasNextPage: false,
    isFetchingNextPage: false,
    fetchNextPage: vi.fn(),
  }),
  useAddNote: () => ({ mutate: vi.fn(), isPending: false }),
}));

vi.mock("@/features/clients/hooks", () => ({
  useContact: () => ({ data: contact }),
  useUpdateContact: () => ({ mutate: mocks.updateContact, isPending: false }),
}));

import { DealDetailPage } from "./deal-detail-page";
import { usePageHistoryStore } from "@/stores/page-history-store";

beforeEach(() => {
  mocks.perms.deals = false;
  mocks.perms.contacts = false;
  dealState = deal;
  mocks.push.mockClear();
  mocks.updateDeal.mockClear();
  mocks.updateContact.mockClear();
});

// Radix dialogs set pointer-events on <body> while open; skip the check in jsdom.
const user = () => userEvent.setup({ pointerEventsCheck: 0 });

const poInput = () => screen.getByPlaceholderText("C-PO / VPO");
const firstNameInput = () => screen.getByDisplayValue("Jane");
const saveButton = () => screen.getByRole("button", { name: "Save" });
const jobsLink = () => screen.getByRole("link", { name: /jobs/i });

const DIALOG_TITLE = "Leave without saving?";

function fireBeforeUnload(): Event {
  const e = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(e);
  return e;
}

describe("DealDetailPage (read only)", () => {
  it("links from the job to the client page", () => {
    render(<DealDetailPage dealId="d1" />);

    const link = screen.getByRole("link", { name: /view client/i });
    expect(link).toHaveAttribute("href", "/contacts/c1");
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

  it("notes are directly editable — textareas immediately, no Edit button", () => {
    render(<DealDetailPage dealId="d1" />);

    expect(screen.getByPlaceholderText(/notes visible to the team/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/internal dispatcher notes/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /edit/i })).toBeNull();
  });

  it("saves only the changed deal keys, once, on Save", async () => {
    const u = user();
    render(<DealDetailPage dealId="d1" />);

    await u.type(poInput(), "PO-777");
    // Editing alone must not auto-commit anymore.
    expect(mocks.updateDeal).not.toHaveBeenCalled();

    await u.click(saveButton());

    expect(mocks.updateDeal).toHaveBeenCalledTimes(1);
    expect(mocks.updateDeal.mock.calls[0][0]).toEqual({ poNumber: "PO-777" });
    expect(mocks.updateContact).not.toHaveBeenCalled();
  });

  it("persists deal and client changes together with one Save click", async () => {
    const u = user();
    render(<DealDetailPage dealId="d1" />);

    await u.type(firstNameInput(), "t"); // Jane → Janet
    await u.type(poInput(), "PO-9");

    await u.click(saveButton());

    expect(mocks.updateDeal).toHaveBeenCalledTimes(1);
    expect(mocks.updateDeal.mock.calls[0][0]).toEqual({ poNumber: "PO-9" });
    expect(mocks.updateContact).toHaveBeenCalledTimes(1);
    expect(mocks.updateContact.mock.calls[0][0]).toMatchObject({
      id: "c1",
      body: { firstName: "Janet" },
    });
  });

  it("holds service-area, schedule and select edits in the draft until Save (no auto-commit)", async () => {
    const u = user();
    render(<DealDetailPage dealId="d1" />);

    await u.type(screen.getByDisplayValue("West Valley"), " North");
    await u.click(screen.getByRole("button", { name: /set date/i }));
    await u.click(screen.getByRole("button", { name: /pick job type/i }));
    await u.click(screen.getByRole("button", { name: /pick source/i }));

    // None of these fields may commit on their own — that's the whole point.
    expect(mocks.updateDeal).not.toHaveBeenCalled();

    await u.click(saveButton());
    expect(mocks.updateDeal).toHaveBeenCalledTimes(1);
    expect(mocks.updateDeal.mock.calls[0][0]).toEqual({
      serviceArea: "West Valley North",
      scheduledDate: "2026-09-01",
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

  it("warns before leaving via the Jobs link while dirty — Stay keeps, Leave navigates", async () => {
    const u = user();
    render(<DealDetailPage dealId="d1" />);

    await u.type(poInput(), "PO-1");

    await u.click(jobsLink());
    expect(await screen.findByText(DIALOG_TITLE)).toBeInTheDocument();

    await u.click(screen.getByRole("button", { name: "Stay" }));
    await waitFor(() => expect(screen.queryByText(DIALOG_TITLE)).toBeNull());
    expect(mocks.push).not.toHaveBeenCalled();

    await u.click(jobsLink());
    expect(await screen.findByText(DIALOG_TITLE)).toBeInTheDocument();

    await u.click(screen.getByRole("button", { name: "Leave" }));
    expect(mocks.push).toHaveBeenCalledWith("/deals");
  });

  it("does not warn on the Jobs link once edits are reset", async () => {
    const u = user();
    render(<DealDetailPage dealId="d1" />);

    await u.type(poInput(), "X-1");
    expect(saveButton()).toBeEnabled();

    await u.click(screen.getByRole("button", { name: "Reset" }));
    expect(poInput()).toHaveValue("");
    expect(saveButton()).toBeDisabled();

    await u.click(jobsLink());
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
