import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  ClientType,
  ContactSource,
  ContactType,
  CrmStatus,
  DealPriority,
  DealStatus,
  JobSuperStatus,
} from "@bitcrm/types";
import type { Contact, Deal } from "@bitcrm/types";

/**
 * The job page's Details tab, laid out the way Workiz lays it out
 * (job_b_01_details_scroll0..3), with our rules underneath: one Save for the
 * whole form, the job's first number locked for good, a rename asking
 * "Change client", nothing here ever making a new client.
 */

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  updateDeal: vi.fn(),
  updateContact: vi.fn(),
  assignTechs: vi.fn(),
  sendToTech: vi.fn(),
  perms: { deals: true, contacts: true, messages: true },
  contact: null as unknown as Contact,
  users: new Map<string, { firstName?: string; lastName?: string; phone?: string; email?: string }>(),
  customFields: [] as unknown[],
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push, replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/deals/d1",
}));

// next/link needs the App Router; a plain anchor does, and the leave guard
// listens on the document, so it must intercept it too.
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

vi.mock("@/features/auth/use-permissions", () => ({
  useDenied: () => () => false,
  usePermissions: () => ({
    can: (resource: string) =>
      resource === "contacts" ? mocks.perms.contacts : resource === "messages" ? mocks.perms.messages : mocks.perms.deals,
    isTechnician: false,
    isLoading: false,
  }),
}));

vi.mock("@/features/clients/hooks", () => ({
  useContact: () => ({ data: mocks.contact }),
  useUpdateContact: () => ({ mutate: mocks.updateContact, isPending: false }),
}));

vi.mock("../hooks", () => ({
  useUpdateDeal: () => ({ mutate: mocks.updateDeal, isPending: false }),
  useAssignTechs: () => ({ mutate: mocks.assignTechs, isPending: false }),
  useUserMap: () => ({ map: mocks.users, users: [], isLoading: false }),
  useSuggestedTechs: () => ({
    data: [
      { id: "t1", firstName: "Bo", lastName: "Diaz", eligible: true, reasons: [] },
      { id: "t2", firstName: "Ann", lastName: "Lee", eligible: true, reasons: [] },
    ],
    isLoading: false,
  }),
  useSendToTech: () => ({ mutate: mocks.sendToTech, isPending: false }),
  useDealAssignments: () => ({ data: [] }),
}));

vi.mock("@/features/service-areas/hooks", () => ({
  useResolvedServiceArea: () => ({ data: undefined }),
  useServiceAreas: () => ({ data: [{ id: "sa-north", name: "North GA", active: true, priority: 1 }] }),
  useEffectiveServiceArea: () => ({ submitId: "sa-north", source: "resolved", area: { id: "sa-north", name: "North GA" }, resolvedArea: { id: "sa-north", name: "North GA" }, isFetching: false }),
  useNearestServiceArea: () => ({ data: undefined }),
}));

vi.mock("@/features/job-types/active-hooks", () => ({
  useActiveJobTypes: () => ({
    data: [
      { id: "jt-lockout", name: "Lockout", active: true },
      { id: "jt-rekey", name: "Rekey", active: true },
    ],
  }),
}));
vi.mock("@/features/job-types/hooks", () => ({
  useJobType: () => ({ data: undefined }),
  useCreateJobType: () => ({ mutate: vi.fn() }),
}));
vi.mock("@/features/job-sources/active-hooks", () => ({
  useActiveJobSources: () => ({ data: [{ id: "src-web", name: "Website", active: true }] }),
}));
vi.mock("@/features/job-sources/hooks", () => ({
  useJobSource: () => ({ data: undefined }),
  useCreateJobSource: () => ({ mutate: vi.fn() }),
}));
vi.mock("@/features/external-companies/hooks", () => ({
  useExternalCompanies: () => ({ data: [{ id: "ec-1", name: "HomeAdvisor", active: true }] }),
}));
vi.mock("@/features/business-profiles/hooks", () => ({
  useActiveBusinessProfiles: () => ({
    data: [{ id: "bp-2", name: "KeyPro", active: true }],
    active: [{ id: "bp-2", name: "KeyPro", active: true }],
    isLoading: false,
  }),
}));
vi.mock("@/features/custom-fields/hooks", () => ({
  useCustomFields: () => ({ data: mocks.customFields }),
}));
vi.mock("../attachments-hooks", () => ({ useAttachmentUrls: () => [] }));
vi.mock("@/features/messaging/hooks", () => ({ useMessagingSettings: () => ({ data: undefined }) }));
vi.mock("@/features/telephony/config-hooks", () => ({
  useTelephonyConfig: () => ({ data: { technicianLine: "+14045550140" }, isLoading: false, isError: false }),
  useJobCode: () => ({ data: { code: "4729" }, isError: false }),
}));
// Calling places a bridged call through telephony; its own tests cover it.
vi.mock("@/features/telephony/components/call-client-button", () => ({
  CallClientButton: ({ to, phoneIndex, variant }: { to: string; phoneIndex?: number; variant?: string }) => (
    <button type="button" aria-label={to ? `Call ${to}` : `Call number ${phoneIndex}`} data-variant={variant} />
  ),
}));
vi.mock("@/features/clients/components/client-chat-sheet", () => ({
  ClientChatSheet: ({ open }: { open: boolean }) => (open ? <div role="dialog" aria-label="Client chat" /> : null),
}));
vi.mock("@/features/telephony/softphone-manager", () => ({ startCall: vi.fn() }));
vi.mock("./tech-chat-sheet", () => ({ TechChatSheet: () => null }));
// The note is a rich-text editor with its own tests; here it is a plain box.
vi.mock("./job-note-editor", () => ({
  JobNoteEditor: ({ value, onChange, editable }: { value: string; onChange: (v: string) => void; editable?: boolean }) => (
    <textarea aria-label="Notes" placeholder="What needs doing…" value={value} readOnly={!editable} onChange={(e) => onChange(e.target.value)} />
  ),
}));
// Google Places and the map need a key and a network; their own tests cover them.
vi.mock("./address-autocomplete", () => ({
  AddressAutocomplete: ({ value, onChange, ariaLabel }: { value: string; onChange: (v: string) => void; ariaLabel?: string }) => (
    <input aria-label={ariaLabel} value={value} onChange={(e) => onChange(e.target.value)} />
  ),
}));
vi.mock("@/features/clients/components/address-map", () => ({ AddressMap: () => <div data-testid="map" /> }));

import Link from "next/link";
import { DetailsTab } from "./deal-details-tab";

const baseContact: Contact = {
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
  serviceArea: "North GA",
  serviceAreaId: "sa-north",
  address: { street: "1 Main", city: "Phoenix", state: "AZ", zip: "85001", lat: 33.4, lng: -112 },
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

const gateCode = {
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
};

beforeEach(() => {
  mocks.perms.deals = true;
  mocks.perms.contacts = true;
  mocks.perms.messages = true;
  mocks.contact = baseContact;
  mocks.users = new Map([["t1", { firstName: "Bo", lastName: "Diaz", phone: "+14045550001" }]]);
  mocks.customFields = [gateCode];
  for (const f of [mocks.push, mocks.updateDeal, mocks.updateContact, mocks.assignTechs, mocks.sendToTech]) f.mockClear();
});

// Radix layers set pointer-events on <body> while open; skip the check in jsdom.
const user = () => userEvent.setup({ pointerEventsCheck: 0 });

function renderTab(d: Deal = deal, canEdit = mocks.perms.deals) {
  return render(
    <>
      {/* Any same-origin link does for the leave guard. */}
      <Link href="/contacts/c1">Jane Smith</Link>
      <DetailsTab deal={d} canEdit={canEdit} />
    </>,
  );
}

const saveButton = () => screen.getByRole("button", { name: "Save" });
const notes = () => screen.getByPlaceholderText(/what needs doing/i);
const section = (name: string) => screen.getByRole("region", { name });
const pick = async (u: ReturnType<typeof user>, combobox: RegExp | string, option: string) => {
  await u.click(screen.getByRole("combobox", { name: combobox }));
  await u.click(await screen.findByRole("option", { name: option }));
};

describe("DetailsTab — Workiz's layout", () => {
  it("has Workiz's sections: Client, Schedule, Job, Team, then the custom-field groups", () => {
    renderTab();

    for (const name of ["Client", "Schedule", "Job", "Team"]) {
      expect(within(section(name)).getAllByRole("heading", { level: 4 })[0]).toHaveTextContent(name);
    }
    expect(screen.getByRole("heading", { name: "Access" })).toBeInTheDocument();
  });

  it("draws the Client fields as Workiz's floating-label boxes", () => {
    renderTab();
    const client = section("Client");

    expect(within(client).getByLabelText("First Name")).toHaveValue("Jane");
    expect(within(client).getByLabelText("Last Name")).toHaveValue("Smith");
    expect(within(client).getByLabelText("Phone")).toHaveValue("(404) 555-1234");
    expect(within(client).getByLabelText("Email")).toHaveValue("");
    expect(within(client).getByRole("combobox", { name: "Service area" })).toBeInTheDocument();
  });

  it("leaves nothing of the old form: no PRIMARY badge, no +1 prefix, no View client link", () => {
    renderTab();
    const client = section("Client");

    expect(within(client).queryByText(/primary/i)).toBeNull();
    expect(within(client).queryByText("+1")).toBeNull();
    expect(screen.queryByRole("link", { name: /view client/i })).toBeNull();
    expect(screen.queryByText(/the first number is the one/i)).toBeNull();
  });

  it("puts the call and the SMS icons inside the Phone box (audit J16)", async () => {
    const u = user();
    renderTab();
    const phoneBox = screen.getByLabelText("Phone").closest("[data-slot=wz-text-field]") as HTMLElement;

    expect(within(phoneBox).getByRole("button", { name: /call \+14045551234/i })).toHaveAttribute("data-variant", "workiz");
    await u.click(within(phoneBox).getByRole("button", { name: "Message client" }));
    expect(screen.getByRole("dialog", { name: "Client chat" })).toBeInTheDocument();
  });

  it("shows our dial-in as Workiz's masked number", () => {
    renderTab();
    expect(within(section("Client")).getByText("Masked number")).toBeInTheDocument();
    expect(screen.getByTestId("job-dial-in")).toHaveTextContent("(404) 555-0140 #4729");
  });

  it("writes the address on one line, the state in full, with directions beside it", () => {
    renderTab();
    const box = screen.getByRole("button", { name: /address: 1 main, phoenix, arizona 85001/i });

    expect(within(box).getByRole("link", { name: "Get directions" })).toHaveAttribute(
      "href",
      expect.stringContaining("google.com/maps/dir"),
    );
  });

  it("has the job's selects in Workiz's order, and ours after them", () => {
    renderTab();
    const names = within(section("Job"))
      .getAllByRole("combobox")
      .map((c) => document.querySelector(`label[for="${c.id}"]`)?.textContent);

    expect(names).toEqual(["Job type", "Job source", "External company", "Company", "Priority"]);
    expect(within(section("Job")).getByPlaceholderText(/what needs doing/i)).toBeInTheDocument();
  });

  it("keeps the yellow Send at the right of Team, opening our send-to-tech card", async () => {
    const u = user();
    renderTab({ ...deal, assignedTechIds: ["t1"] });

    await u.click(within(section("Team")).getByRole("button", { name: "Send" }));
    const card = await screen.findByTestId("send-to-tech");
    await u.click(within(card).getByRole("button", { name: /send to tech/i }));
    expect(mocks.sendToTech).toHaveBeenCalledWith({ channels: ["sms"] });
  });
});

describe("DetailsTab — one Save", () => {
  it("renders exactly one Save, disabled while clean, and no Reset", () => {
    renderTab();

    expect(screen.getAllByRole("button", { name: /save/i })).toHaveLength(1);
    expect(saveButton()).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Reset" })).toBeNull();
  });

  it("keeps the Save bar pinned to the bottom while the page scrolls", () => {
    renderTab();
    const bar = saveButton().parentElement as HTMLElement;
    expect(bar.className).toMatch(/sticky/);
    expect(bar.className).toMatch(/bottom-0/);
  });

  it("saves only the changed deal keys, once, on Save", async () => {
    const u = user();
    renderTab();

    await u.type(notes(), "PO-777");
    expect(mocks.updateDeal).not.toHaveBeenCalled();
    await u.click(saveButton());

    expect(mocks.updateDeal).toHaveBeenCalledTimes(1);
    expect(mocks.updateDeal.mock.calls[0][0]).toEqual({ notes: "PO-777" });
    expect(mocks.updateContact).not.toHaveBeenCalled();
  });

  it("holds the job's selects in the draft until Save", async () => {
    const u = user();
    renderTab();

    await pick(u, "Job type", "Rekey");
    await pick(u, "Job source", "Website");
    await pick(u, "External company", "HomeAdvisor");
    await pick(u, "Company", "KeyPro");
    await pick(u, "Priority", "Urgent");
    expect(mocks.updateDeal).not.toHaveBeenCalled();

    await u.click(saveButton());
    expect(mocks.updateDeal.mock.calls[0][0]).toEqual({
      jobTypeId: "jt-rekey",
      sourceId: "src-web",
      externalCompanyId: "ec-1",
      businessProfileId: "bp-2",
      priority: DealPriority.URGENT,
    });
  });

  it("unschedules with the Schedule switch: the job goes back to Unscheduled on Save", async () => {
    const u = user();
    renderTab({ ...deal, scheduledDate: "2026-10-08", scheduledEndDate: "2026-10-08", scheduledTimeSlot: "08:00-09:00" });

    await u.click(screen.getByRole("switch", { name: "Schedule" }));
    await u.click(saveButton());

    expect(mocks.updateDeal.mock.calls[0][0]).toEqual({ scheduledDate: null });
  });

  it("marks the page dirty when a custom field is edited and sends it on Save", async () => {
    const u = user();
    renderTab();

    await u.type(screen.getByLabelText("Gate Code"), "4417");
    expect(saveButton()).toBeEnabled();
    await u.click(saveButton());

    expect(mocks.updateDeal.mock.calls[0][0]).toEqual({ customFields: { "cf-gate": "4417" } });
  });

  it("keeps unsaved edits when an instant action refetches the job (updatedAt bump)", async () => {
    const u = user();
    const { rerender } = renderTab();

    await u.type(notes(), "PO-KEEP");
    rerender(
      <>
        <Link href="/contacts/c1">Jane Smith</Link>
        <DetailsTab deal={{ ...deal, updatedAt: "2026-07-31T12:00:00Z" }} canEdit />
      </>,
    );

    expect(notes()).toHaveValue("PO-KEEP");
    expect(saveButton()).toBeEnabled();
  });

  it("warns before leaving via a link while dirty — Stay keeps, Leave navigates", async () => {
    const u = user();
    renderTab();

    await u.type(notes(), "PO-1");
    await u.click(screen.getByRole("link", { name: "Jane Smith" }));
    expect(await screen.findByText("Leave without saving?")).toBeInTheDocument();
    await u.click(screen.getByRole("button", { name: "Stay" }));
    await waitFor(() => expect(screen.queryByText("Leave without saving?")).toBeNull());

    await u.click(screen.getByRole("link", { name: "Jane Smith" }));
    await u.click(await screen.findByRole("button", { name: "Leave" }));
    expect(mocks.push).toHaveBeenCalledWith("/contacts/c1");
  });

  it("blocks beforeunload only while dirty", async () => {
    const u = user();
    renderTab();
    const fire = () => {
      const e = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(e);
      return e;
    };

    expect(fire().defaultPrevented).toBe(false);
    await u.type(notes(), "PO-2");
    expect(fire().defaultPrevented).toBe(true);
  });
});

describe("DetailsTab — the client", () => {
  it("locks the number the job was created with — no editing, no removing it", () => {
    renderTab();

    expect(screen.getByLabelText("Phone")).toBeDisabled();
    expect(screen.queryByRole("button", { name: /remove phone/i })).toBeNull();
    expect(screen.getByRole("button", { name: "Add Phone" })).toBeInTheDocument();
  });

  it("adds a second number straight to the client — phones never prompt", async () => {
    const u = user();
    renderTab();

    await u.click(screen.getByRole("button", { name: "Add Phone" }));
    const phones = screen.getAllByLabelText("Phone");
    await u.type(phones[1], "2028398283");
    expect(phones[1]).toHaveValue("(202) 839-8283");
    await u.click(saveButton());

    expect(screen.queryByText("Change client")).toBeNull();
    expect(mocks.updateContact).toHaveBeenCalledTimes(1);
    expect(mocks.updateContact.mock.calls[0][0]).toMatchObject({
      id: "c1",
      body: { phones: ["+14045551234", "+12028398283"] },
    });
  });

  it("removes an added number again", async () => {
    const u = user();
    renderTab();

    await u.click(screen.getByRole("button", { name: "Add Phone" }));
    expect(screen.getAllByLabelText("Phone")).toHaveLength(2);
    await u.click(screen.getByRole("button", { name: /remove phone/i }));
    expect(screen.getAllByLabelText("Phone")).toHaveLength(1);
    expect(saveButton()).toBeDisabled();
  });

  it("keeps a half-typed number off the Save", async () => {
    const u = user();
    renderTab();

    await u.click(screen.getByRole("button", { name: "Add Phone" }));
    await u.type(screen.getAllByLabelText("Phone")[1], "202");
    expect(saveButton()).toBeDisabled();
  });

  it("renaming asks 'Change client'; 'Just here' keeps the name on the job only", async () => {
    const u = user();
    renderTab();

    await u.type(screen.getByLabelText("First Name"), "t");
    await u.click(saveButton());
    expect(screen.getByText("Change client")).toBeInTheDocument();
    await u.click(screen.getByRole("button", { name: /just here/i }));

    expect(mocks.updateDeal.mock.calls[0][0]).toMatchObject({ clientName: { firstName: "Janet", lastName: "Smith" } });
    expect(mocks.updateContact).not.toHaveBeenCalled();
  });

  it("'Yes, make change' applies the rename to the client record", async () => {
    const u = user();
    renderTab();

    await u.type(screen.getByLabelText("First Name"), "t");
    await u.type(notes(), "PO-9");
    await u.click(saveButton());
    await u.click(screen.getByRole("button", { name: /yes, make change/i }));

    expect(mocks.updateDeal.mock.calls[0][0]).toEqual({ notes: "PO-9" });
    expect(mocks.updateContact.mock.calls[0][0]).toMatchObject({ id: "c1", body: { firstName: "Janet" } });
  });

  it("opens clean on a job with its own name for the client, and keeps the contact's name on a phone save", async () => {
    const u = user();
    renderTab({ ...deal, clientName: { firstName: "Clinic", lastName: "Of Weatherford" } });

    expect(screen.getByLabelText("First Name")).toHaveValue("Clinic");
    expect(saveButton()).toBeDisabled();

    await u.click(screen.getByRole("button", { name: "Add Phone" }));
    await u.type(screen.getAllByLabelText("Phone")[1], "2028398283");
    await u.click(saveButton());
    expect(mocks.updateContact.mock.calls[0][0].body).toMatchObject({ firstName: "Jane", lastName: "Smith" });
    expect(mocks.updateDeal).not.toHaveBeenCalled();
  });

  it("shows a masked viewer's numbers as locked Phone boxes they can still call from", () => {
    mocks.contact = { ...baseContact, phones: [], phonesMasked: true, phoneCount: 1 };
    renderTab();

    expect(within(section("Client")).getByText("Number hidden")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Call number 0" })).toHaveAttribute("data-variant", "workiz");
  });
});

describe("DetailsTab — the address pane", () => {
  it("edits the address in Workiz's Address pane; the page's Save writes it", async () => {
    const u = user();
    renderTab();

    await u.click(screen.getByRole("button", { name: /address: 1 main/i }));
    const pane = await screen.findByRole("dialog", { name: "Address" });
    const city = within(pane).getByLabelText("City");
    await u.clear(city);
    await u.type(city, "Tempe");
    await pick(u, "Country", "Canada");
    await u.click(within(pane).getByRole("button", { name: "Save" }));

    expect(screen.getByRole("button", { name: /address: 1 main, tempe, az 85001, canada/i })).toBeInTheDocument();
    expect(mocks.updateDeal).not.toHaveBeenCalled();

    await u.click(saveButton());
    // A new address may be kept on the client too.
    await u.click(await screen.findByRole("button", { name: /save job/i }));
    expect(mocks.updateDeal.mock.calls[0][0]).toEqual({
      address: expect.objectContaining({ street: "1 Main", city: "Tempe", country: "CA" }),
    });
  });

  it("Cancel leaves the address as it was", async () => {
    const u = user();
    renderTab();

    await u.click(screen.getByRole("button", { name: /address: 1 main/i }));
    const pane = await screen.findByRole("dialog", { name: "Address" });
    await u.type(within(pane).getByLabelText("City"), "x");
    await u.click(within(pane).getByRole("button", { name: "Cancel" }));

    expect(screen.getByRole("button", { name: /address: 1 main, phoenix, arizona 85001/i })).toBeInTheDocument();
    expect(saveButton()).toBeDisabled();
  });

  it("offers the client's saved addresses as Client properties", async () => {
    const u = user();
    mocks.contact = { ...baseContact, addresses: [{ street: "9 Elm", city: "Dallas", state: "TX", zip: "75201" }] };
    renderTab();

    await u.click(screen.getByRole("button", { name: /address: 1 main/i }));
    await pick(u, "Client properties", "9 Elm, Dallas, Texas 75201");
    await u.click(within(screen.getByRole("dialog", { name: "Address" })).getByRole("button", { name: "Save" }));

    expect(screen.getByRole("button", { name: /address: 9 elm, dallas, texas 75201/i })).toBeInTheDocument();
  });

  it("does not write the contact when a deals-only user changes the address", async () => {
    const u = user();
    mocks.perms.contacts = false;
    renderTab();

    await u.click(screen.getByRole("button", { name: /address: 1 main/i }));
    const pane = await screen.findByRole("dialog", { name: "Address" });
    await u.type(within(pane).getByLabelText("City"), "burg");
    await u.click(within(pane).getByRole("button", { name: "Save" }));
    await u.click(saveButton());

    expect(mocks.updateDeal.mock.calls[0][0]).toHaveProperty("address");
    expect(mocks.updateContact).not.toHaveBeenCalled();
  });
});

describe("DetailsTab — the team", () => {
  it("lists each technician on a row of their own and takes one off from it", async () => {
    const u = user();
    renderTab({ ...deal, assignedTechIds: ["t1"] });
    const team = section("Team");

    expect(within(team).getByText("Bo Diaz")).toBeInTheDocument();
    await u.click(within(team).getByRole("button", { name: "Remove Bo Diaz" }));
    expect(mocks.assignTechs).toHaveBeenCalledWith([]);
  });

  it("adds a technician with Assign A Tech", async () => {
    const u = user();
    renderTab({ ...deal, assignedTechIds: ["t1"] });

    await pick(u, "Assign A Tech", "Ann Lee");
    expect(mocks.assignTechs).toHaveBeenCalledWith(["t1", "t2"]);
  });

  it("says how many techs work in the area and can do the job", () => {
    renderTab();
    expect(screen.getByTestId("wz-team-notice")).toHaveTextContent("2 techs work in North GA and can perform Lockout");
  });
});

describe("DetailsTab — read only", () => {
  beforeEach(() => {
    mocks.perms.deals = false;
    mocks.perms.contacts = false;
  });

  it("shows every field disabled, with no Save bar and no Add Phone", () => {
    renderTab();

    expect(screen.getByLabelText("First Name")).toBeDisabled();
    expect(screen.getByLabelText("Email")).toBeDisabled();
    expect(screen.getByLabelText("Ext")).toBeDisabled();
    expect(screen.getByRole("combobox", { name: "Job type" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Add Phone" })).toBeNull();
    expect(screen.queryByRole("combobox", { name: "Assign A Tech" })).toBeNull();
  });

  it("still lets them call the client from the Phone box", () => {
    renderTab();
    expect(screen.getByRole("button", { name: /call \+14045551234/i })).toBeInTheDocument();
  });

  it("keeps the address box shut", () => {
    renderTab();
    expect(screen.queryByRole("button", { name: /address:/i })).toBeNull();
    expect(screen.getByText("1 Main, Phoenix, Arizona 85001")).toBeInTheDocument();
  });

  it("lets them see the send-to-tech card, read only", async () => {
    const u = user();
    renderTab();

    await u.click(screen.getByRole("button", { name: "Send" }));
    expect(within(await screen.findByTestId("send-to-tech")).getByRole("button", { name: /send to tech/i })).toBeDisabled();
  });
});
