import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  ClientType,
  ContactSource,
  ContactType,
  CrmStatus,
  type Contact,
} from "@bitcrm/types";

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  createDeal: vi.fn(),
  copyEstimate: vi.fn(async () => ({ estimate: { id: "e9" }, itemCount: 1 })),
  createContact: vi.fn(),
  updateContact: vi.fn(),
  linkCall: vi.fn(),
  customFieldDefs: [] as unknown[],
  requiredFields: {} as Record<string, boolean>,
  searchParams: "contactId=c1&callSid=CA1",
  requestUpload: vi.fn(),
  uploadBytes: vi.fn(),
  updateDealApi: vi.fn(),
  createCompany: vi.fn(),
  companyMap: new Map<string, { id: string; title: string; clientType?: string }>(),
  effectiveArea: null as null | Record<string, unknown>,
  searchHits: [] as unknown[],
  phoneOwner: null as unknown,
  perms: { custom_fields: true } as Record<string, boolean>,
  companies: [
    { id: "bp-default", name: "SureLock", isDefault: true, active: true },
    { id: "bp-2", name: "KeyPro", isDefault: false, active: true },
    { id: "bp-area", name: "Area Co", isDefault: false, active: true },
  ] as unknown[],
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push, replace: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(mocks.searchParams),
}));
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}));
vi.mock("@/features/auth/use-permissions", () => ({
  usePermissions: () => ({ can: (r: string) => Boolean(mocks.perms[r]), isLoading: false, isTechnician: false }),
}));

const contact: Contact = {
  id: "c1",
  firstName: "Jane",
  lastName: "Smith",
  phones: ["+14045551234"],
  emails: [],
  addresses: [{ street: "1 Main", unit: "", city: "Phoenix", state: "AZ", zip: "85001" }],
  type: ContactType.RESIDENTIAL,
  source: ContactSource.PHONE_CALL,
  status: CrmStatus.ACTIVE,
  createdBy: "u1",
  createdAt: "",
  updatedAt: "",
};

const dustin: Contact = {
  ...contact,
  id: "c-dustin",
  firstName: "Dustin",
  lastName: "Roselle",
  phones: ["+14693968179"],
  emails: ["dustin@example.com"],
  addresses: [{ street: "Princeton", city: "Princeton", state: "TX", zip: "75407", lat: 33.18, lng: -96.5 }],
};

vi.mock("@/features/clients/hooks", () => ({
  useContact: (id: string) => ({ data: id ? contact : undefined }),
  useContactSearch: (q: string) => ({ data: q ? mocks.searchHits : [], isLoading: false, answered: true }),
  useContactByPhone: (_phone: string, enabled: boolean) => ({ data: enabled ? mocks.phoneOwner : null }),
  useCreateContact: () => ({ mutate: mocks.createContact, isPending: false }),
  useUpdateContact: () => ({ mutate: mocks.updateContact, isPending: false }),
  useCreateCompany: () => ({ mutate: mocks.createCompany, isPending: false }),
  useCompanyMap: () => ({ map: mocks.companyMap, companies: [...mocks.companyMap.values()] }),
}));
vi.mock("../hooks", () => ({
  useCreateDeal: () => ({ mutate: mocks.createDeal, isPending: false }),
}));
// Every hook the form reads is stubbed, so the form is up from the first
// render (the load itself is covered by new-deal-page.loading.test.tsx).
vi.mock("../new-job-page-data", () => ({ useNewJobPageData: () => ({ ready: true }) }));
vi.mock("@/features/calls/hooks", () => ({
  useLinkCallToDeal: () => ({ mutate: mocks.linkCall, isPending: false }),
}));
vi.mock("@/features/calls/components/calls-to-link", () => ({ CallsToLink: () => null }));
vi.mock("@/features/custom-fields/hooks", () => ({
  useCustomFields: () => ({ data: mocks.customFieldDefs }),
}));
vi.mock("@/features/job-field-settings/hooks", () => ({
  useJobFieldSettings: () => ({ data: { requiredFields: mocks.requiredFields }, isLoading: false }),
}));
vi.mock("@/features/job-tags/hooks", () => ({
  useJobTags: () => ({ data: [{ id: "t-vip", name: "VIP" }] }),
}));
vi.mock("../attachments-api", () => ({
  requestAttachmentUpload: (...args: unknown[]) => mocks.requestUpload(...args),
  uploadAttachmentBytes: (...args: unknown[]) => mocks.uploadBytes(...args),
}));
vi.mock("../attachments-hooks", () => ({ useAttachmentUrls: () => [] }));
vi.mock("../api", () => ({
  updateDeal: (...args: unknown[]) => mocks.updateDealApi(...args),
}));
vi.mock("@/features/business-profiles/hooks", () => ({
  useBusinessProfiles: () => ({ data: mocks.companies }),
}));
vi.mock("@/features/service-areas/hooks", () => ({
  useEffectiveServiceArea: () =>
    mocks.effectiveArea ?? { submitId: undefined, source: null, area: null, resolvedArea: null, isFetching: false },
}));
// The data-bound selects have their own suite; here they are buttons that
// pick, and readouts of what the page handed them.
vi.mock("./workiz/catalog-selects", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./workiz/catalog-selects")>();
  return {
    ...actual,
    WzJobTypeSelect: ({ onChange, error }: { onChange: (v: string) => void; error?: string }) => (
      <div>
        <button type="button" onClick={() => onChange("jt-rekey")}>pick job type</button>
        {error ? <span>{error}</span> : null}
      </div>
    ),
    WzJobSourceSelect: ({ value, error }: { value?: string; error?: string }) => (
      <div data-testid="job-source-select">
        {value ?? ""}
        {error ? <span>{error}</span> : null}
      </div>
    ),
    WzBusinessProfileSelect: ({ value, onChange }: { value?: string | null; onChange: (v: string) => void }) => (
      <div>
        <span data-testid="company-select">{value ?? ""}</span>
        <button type="button" onClick={() => onChange("bp-picked")}>pick company</button>
      </div>
    ),
    WzExternalCompanySelect: () => null,
    WzServiceAreaSelect: () => null,
    WzTeamSelect: () => null,
  };
});
// The address box is a plain input whose typing stands for picking a whole
// Google address (street + city/state/zip).
vi.mock("./workiz/address-field", () => ({
  WzAddressField: ({
    value,
    onSelect,
  }: {
    value: string;
    onSelect: (a: { street: string; city: string; state: string; zip: string }) => void;
  }) => (
    <input
      aria-label="street"
      value={value}
      onChange={(e) => onSelect({ street: e.target.value, city: "Phoenix", state: "AZ", zip: "85001" })}
    />
  ),
}));

vi.mock("@/features/estimates/api", () => ({ copyEstimateToJob: mocks.copyEstimate }));
import { NewDealPage } from "./new-deal-page";

const user = () => userEvent.setup();
const submit = () => screen.getByRole("button", { name: "Create" });
const clientName = () => screen.getByRole("combobox", { name: "Client name" });
const pickJobType = (u: ReturnType<typeof user>) => u.click(screen.getByRole("button", { name: /pick job type/i }));
const lastDeal = () => mocks.createDeal.mock.calls.at(-1)?.[0];
const def = (id: string, name: string, group: string, over: Record<string, unknown> = {}) => ({
  id,
  name,
  type: "text",
  group,
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
  ...over,
});

beforeEach(() => {
  mocks.searchParams = "contactId=c1&callSid=CA1";
  mocks.customFieldDefs = [];
  mocks.requiredFields = {};
  mocks.effectiveArea = null;
  mocks.searchHits = [];
  mocks.phoneOwner = null;
  mocks.companyMap = new Map();
  mocks.perms = { custom_fields: true };
  for (const m of [
    mocks.push,
    mocks.createDeal,
    mocks.createContact,
    mocks.updateContact,
    mocks.linkCall,
    mocks.createCompany,
    mocks.requestUpload,
    mocks.uploadBytes,
    mocks.updateDealApi,
  ]) {
    m.mockReset();
  }
});

describe("NewDealPage — Workiz layout", () => {
  it("is 'New Job' with Workiz's cards, a yellow Create and nothing of ours on top", () => {
    render(<NewDealPage />);
    expect(screen.getByRole("heading", { level: 1, name: "New Job" })).toBeInTheDocument();
    for (const title of ["Client Details", "Service Location", "Job Details"]) {
      expect(screen.getByRole("region", { name: title })).toBeInTheDocument();
    }
    expect(screen.getByRole("region", { name: /^Scheduled/ })).toBeInTheDocument();
    expect(submit()).toBeEnabled();
    expect(screen.queryByText(/everything on one page/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /cancel/i })).not.toBeInTheDocument();
  });

  it("asks what Workiz asks, in its words, and no more", () => {
    mocks.searchParams = "";
    render(<NewDealPage />);
    expect(clientName()).toBeInTheDocument();
    for (const name of ["Company name", "Ext", "Email", "Unit", "City", "Zip", "Job name"]) {
      expect(screen.getByRole("textbox", { name })).toBeInTheDocument();
    }
    expect(screen.getByRole("textbox", { name: "Phone" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "State" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Country" })).toBeInTheDocument();
    expect(screen.getByText("United States")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Description" })).toBeInTheDocument();
    // Gone: our extra fields Workiz does not ask for.
    for (const gone of ["Priority", "Client type", "PO number", "Work order link", "Tags"]) {
      expect(screen.queryByText(gone)).not.toBeInTheDocument();
    }
    expect(screen.queryByText(/recurring/i)).not.toBeInTheDocument();
  });

  it("offers 'Add a custom field' to whoever may add one", () => {
    const { unmount } = render(<NewDealPage />);
    expect(screen.getByRole("link", { name: "Add a custom field" })).toHaveAttribute("href", "/settings/custom-fields");
    expect(screen.getByText(/Need to track more fields\?/)).toBeInTheDocument();
    unmount();
    mocks.perms = {};
    render(<NewDealPage />);
    expect(screen.queryByRole("link", { name: "Add a custom field" })).not.toBeInTheDocument();
  });

  it("renders each custom-field group as its own card, Workiz-ordered", () => {
    mocks.customFieldDefs = [def("cf-t", "Check Image Front", "Tech"), def("cf-e", "Jobs Dispatch", "Extra Info")];
    render(<NewDealPage />);
    const titles = screen.getAllByText(/^(Extra Info|Tech)$/).map((el) => el.textContent);
    expect(titles).toEqual(["Extra Info", "Tech"]);
    expect(screen.getByRole("textbox", { name: "Check Image Front" })).toBeInTheDocument();
  });

  it("shows PO number and Tags only when an admin made them required", () => {
    mocks.requiredFields = { poNumber: true, tags: true };
    render(<NewDealPage />);
    expect(screen.getByRole("textbox", { name: "PO number" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Tags" })).toBeInTheDocument();
  });
});

describe("NewDealPage — Create blocked: 'Required field' under each field", () => {
  it("marks the client, the job type and every admin-required field, and creates nothing", async () => {
    mocks.searchParams = "";
    mocks.requiredFields = { source: true, description: true };
    const u = user();
    render(<NewDealPage />);
    await u.click(submit());

    expect(mocks.createDeal).not.toHaveBeenCalled();
    expect(clientName()).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("status")).toHaveTextContent(
      "Missing required: Client, Job type, Service address, Job source, Job note",
    );
    // Client name, job type, city, state, zip, source, description (the
    // street's own mark is the address field's, stubbed here).
    expect(screen.getAllByText("Required field")).toHaveLength(7);
    expect(screen.getByRole("combobox", { name: "State" })).toHaveAttribute("aria-invalid", "true");
  });

  it("counts missing custom fields in", async () => {
    mocks.customFieldDefs = [def("cf-check", "Check Number", "Tech", { required: true })];
    const u = user();
    render(<NewDealPage />);
    await pickJobType(u);
    await u.click(submit());
    expect(mocks.createDeal).not.toHaveBeenCalled();
    expect(screen.getByRole("status")).toHaveTextContent("Missing required: Check Number");
    expect(screen.getByRole("textbox", { name: "Check Number" })).toHaveAttribute("aria-invalid", "true");
  });

  it("clears a mark as soon as its field is filled", async () => {
    mocks.searchParams = "";
    const u = user();
    render(<NewDealPage />);
    await u.click(submit());
    expect(clientName()).toHaveAttribute("aria-invalid", "true");
    await u.type(clientName(), "Nova");
    expect(clientName()).not.toHaveAttribute("aria-invalid");
  });
});

describe("NewDealPage — a new client, typed in", () => {
  beforeEach(() => {
    mocks.searchParams = "";
    mocks.createContact.mockImplementation(
      (body: { firstName: string; lastName: string }, opts?: { onSuccess?: (c: unknown) => void }) =>
        opts?.onSuccess?.({ ...contact, id: "c-new", firstName: body.firstName, lastName: body.lastName }),
    );
  });

  const fill = async (u: ReturnType<typeof user>, name: string) => {
    await u.type(clientName(), name);
    await u.type(screen.getByLabelText("street"), "9 Elm");
    await pickJobType(u);
  };

  it("splits 'Client name' on the first space and creates the client, then the job under them", async () => {
    const u = user();
    render(<NewDealPage />);
    await fill(u, "Nova Client Jr");
    await u.click(submit());

    expect(mocks.createContact).toHaveBeenCalledWith(
      expect.objectContaining({
        firstName: "Nova",
        lastName: "Client Jr",
        type: ContactType.RESIDENTIAL,
        addresses: [expect.objectContaining({ street: "9 Elm" })],
      }),
      expect.anything(),
    );
    expect(mocks.createDeal).toHaveBeenCalledWith(
      expect.objectContaining({ contactId: "c-new", clientType: ClientType.RESIDENTIAL }),
      expect.anything(),
    );
  });

  it("one word is a first name with an empty last name", async () => {
    const u = user();
    render(<NewDealPage />);
    await fill(u, "Cher");
    await u.click(submit());
    expect(mocks.createContact.mock.calls[0][0]).toMatchObject({ firstName: "Cher", lastName: "" });
  });

  it("sends the phone with its extension keyed by the number, and the email", async () => {
    const u = user();
    render(<NewDealPage />);
    await fill(u, "Nova Client");
    await u.type(screen.getByRole("textbox", { name: "Phone" }), "4045550123");
    await u.type(screen.getByRole("textbox", { name: "Ext" }), "12");
    await u.type(screen.getByRole("textbox", { name: "Email" }), "nova@example.com");
    expect(screen.getByRole("textbox", { name: "Phone" })).toHaveValue("(404) 555-0123");
    await u.click(submit());
    expect(mocks.createContact.mock.calls[0][0]).toMatchObject({
      phones: ["+14045550123"],
      phoneExtensions: { "+14045550123": "12" },
      emails: ["nova@example.com"],
    });
  });

  it("'Add phone' adds a second number and goes away", async () => {
    const u = user();
    render(<NewDealPage />);
    await u.click(screen.getByRole("button", { name: "Add phone" }));
    expect(screen.getByRole("textbox", { name: "Phone 2" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add phone" })).not.toBeInTheDocument();
  });

  it("files the client under the company named — an existing one, matched by title", async () => {
    mocks.companyMap = new Map([["co-1", { id: "co-1", title: "Acme Locks", clientType: ClientType.COMMERCIAL }]]);
    const u = user();
    render(<NewDealPage />);
    await fill(u, "Nova Client");
    await u.type(screen.getByRole("textbox", { name: "Company name" }), "acme locks");
    await u.click(submit());
    expect(mocks.createCompany).not.toHaveBeenCalled();
    expect(mocks.createContact.mock.calls[0][0]).toMatchObject({
      companyId: "co-1",
      type: ContactType.COMPANY_REPRESENTATIVE,
    });
    expect(lastDeal()).toMatchObject({ clientType: ClientType.COMMERCIAL });
  });

  it("…or a new company, created first", async () => {
    mocks.createCompany.mockImplementation((_b: unknown, opts?: { onSuccess?: (c: unknown) => void }) =>
      opts?.onSuccess?.({ id: "co-new", title: "Globex" }),
    );
    const u = user();
    render(<NewDealPage />);
    await fill(u, "Nova Client");
    await u.type(screen.getByRole("textbox", { name: "Company name" }), "Globex");
    await u.click(submit());
    expect(mocks.createCompany).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Globex", clientType: ClientType.COMMERCIAL }),
      expect.anything(),
    );
    expect(mocks.createContact.mock.calls[0][0]).toMatchObject({ companyId: "co-new" });
    expect(lastDeal()).toMatchObject({ clientType: ClientType.COMMERCIAL });
  });

  it("a number that already belongs to a client offers them, and Create adopts them instead of a twin", async () => {
    mocks.phoneOwner = dustin;
    const u = user();
    render(<NewDealPage />);
    await u.type(screen.getByRole("textbox", { name: "Phone" }), "4693968179");
    expect(screen.getByText(/a client already has this phone/i)).toBeInTheDocument();
    await u.type(screen.getByLabelText("street"), "9 Elm");
    await pickJobType(u);
    await u.click(submit());
    expect(mocks.createContact).not.toHaveBeenCalled();
    expect(lastDeal()).toMatchObject({ contactId: "c-dustin" });
  });
});

describe("NewDealPage — picking a client from the search", () => {
  beforeEach(() => {
    mocks.searchParams = "";
    mocks.searchHits = [dustin];
  });

  it("lists '+ Add new' first, then the matches with their street", async () => {
    const u = user();
    render(<NewDealPage />);
    await u.type(clientName(), "Dustin");
    const list = screen.getByRole("listbox", { name: "Clients" });
    const rows = within(list).getAllByRole("option");
    expect(rows[0]).toHaveTextContent('+ Add new "Dustin"');
    expect(rows[1]).toHaveTextContent("Dustin Roselle");
    expect(rows[1]).toHaveTextContent("Princeton");
  });

  it("fills the card and the service location, with 'Client: <name>' and Unassign", async () => {
    const u = user();
    render(<NewDealPage />);
    await u.type(clientName(), "Dustin");
    await u.click(screen.getByRole("option", { name: /Dustin Roselle/ }));

    expect(screen.getByRole("link", { name: "Dustin Roselle" })).toHaveAttribute("href", "/contacts/c-dustin");
    expect(clientName()).toHaveValue("Dustin Roselle");
    expect(screen.getByRole("textbox", { name: "Phone" })).toHaveValue("(469) 396-8179");
    expect(screen.getByRole("textbox", { name: "Email" })).toHaveValue("dustin@example.com");
    expect(screen.getByLabelText("street")).toHaveValue("Princeton");
    expect(screen.getByText("Verified")).toBeInTheDocument();

    await u.click(screen.getByRole("button", { name: "Unassign" }));
    expect(screen.queryByRole("link", { name: "Dustin Roselle" })).not.toBeInTheDocument();
    expect(clientName()).toHaveValue("");
  });

  it("creates the job for the picked client without asking", async () => {
    const u = user();
    render(<NewDealPage />);
    await u.type(clientName(), "Dustin");
    await u.click(screen.getByRole("option", { name: /Dustin Roselle/ }));
    await pickJobType(u);
    await u.click(submit());
    expect(mocks.createContact).not.toHaveBeenCalled();
    expect(lastDeal()).toMatchObject({
      contactId: "c-dustin",
      address: expect.objectContaining({ street: "Princeton", country: "US" }),
    });
  });
});

describe("NewDealPage — the job", () => {
  it("sends Job name, the Description and the address's country", async () => {
    const u = user();
    render(<NewDealPage />);
    await u.type(screen.getByRole("textbox", { name: "Job name" }), "Gate repair");
    await pickJobType(u);
    await u.click(submit());
    expect(lastDeal()).toMatchObject({
      jobName: "Gate repair",
      address: expect.objectContaining({ street: "1 Main", country: "US" }),
    });
  });

  it("an empty Description is no note at all", async () => {
    const u = user();
    render(<NewDealPage />);
    await pickJobType(u);
    await u.click(submit());
    expect(lastDeal().notes).toBeUndefined();
  });

  it("switching Scheduled off makes an unscheduled job", async () => {
    const u = user();
    render(<NewDealPage />);
    await u.click(screen.getByRole("switch", { name: "Scheduled" }));
    await pickJobType(u);
    await u.click(submit());
    expect(lastDeal()).toMatchObject({ scheduledDate: undefined, scheduledEndDate: undefined, scheduledTimeSlot: undefined });
  });
});

describe("NewDealPage — deferred file uploads", () => {
  it("holds the picked file and uploads it right after the job is created", async () => {
    mocks.customFieldDefs = [def("cf-file", "Check Image Front", "Tech", { type: "file" })];
    mocks.requestUpload.mockResolvedValue({ id: "att-1", uploadUrl: "https://s3/upload", s3Key: "k", headers: { "Content-Type": "image/jpeg" } });
    mocks.uploadBytes.mockResolvedValue(undefined);
    mocks.updateDealApi.mockResolvedValue({});
    mocks.createDeal.mockImplementation((_b: unknown, opts?: { onSuccess?: (d: unknown) => void }) =>
      opts?.onSuccess?.({ id: "d-new" }),
    );

    const u = user();
    render(<NewDealPage />);
    expect(screen.queryByText(/save the job first/i)).not.toBeInTheDocument();
    const file = new File(["bytes"], "check.jpg", { type: "image/jpeg" });
    fireEvent.change(screen.getByLabelText("Add files to Check Image Front", { selector: "input" }), {
      target: { files: [file] },
    });
    expect(await screen.findByRole("button", { name: "Open check.jpg" })).toBeInTheDocument();

    await pickJobType(u);
    await u.click(submit());

    await waitFor(() =>
      expect(mocks.requestUpload).toHaveBeenCalledWith("d-new", expect.objectContaining({ fileName: "check.jpg" })),
    );
    expect(mocks.uploadBytes).toHaveBeenCalled();
    await waitFor(() =>
      expect(mocks.updateDealApi).toHaveBeenCalledWith("d-new", {
        customFields: expect.objectContaining({ "cf-file": ["att-1"] }),
      }),
    );
    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith("/deals/d-new"));
  });
});

describe("NewDealPage — opened from the client card", () => {
  beforeEach(() => {
    mocks.createDeal.mockImplementation((_b: unknown, opts?: { onSuccess?: (d: unknown) => void }) =>
      opts?.onSuccess?.({ id: "d-new", dealNumber: "NEW001" }),
    );
  });

  it("`?then=estimate` lands on the new job's Estimates tab with a new estimate started", async () => {
    mocks.searchParams = "contactId=c1&then=estimate";
    const u = user();
    render(<NewDealPage />);
    await pickJobType(u);
    await u.click(submit());
    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith("/deals/d-new?tab=estimates&estimate=new"));
  });

  it("`?then=copy-estimate:<id>` copies the client estimate onto the new job, then opens it there", async () => {
    mocks.searchParams = "contactId=c1&then=copy-estimate%3Ae9";
    const u = user();
    render(<NewDealPage />);
    await pickJobType(u);
    await u.click(submit());
    await waitFor(() => expect(mocks.copyEstimate).toHaveBeenCalledWith("e9", "d-new"));
    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith("/estimates/e9"));
  });

  // The job page has no Invoice tab (Workiz): its "Create Invoice" is on the job itself.
  it("`?then=invoice` lands on the new job, where Create Invoice is", async () => {
    mocks.searchParams = "contactId=c1&then=invoice";
    const u = user();
    render(<NewDealPage />);
    await pickJobType(u);
    await u.click(submit());
    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith("/deals/d-new"));
  });

  it("`?address=N` prefills that one of the client's addresses; `address=new` leaves it empty", () => {
    contact.addresses.push({ street: "9 Oak Ave", unit: "", city: "Mesa", state: "AZ", zip: "85201" });
    try {
      mocks.searchParams = "contactId=c1&address=1";
      const first = render(<NewDealPage />);
      expect(screen.getByDisplayValue("9 Oak Ave")).toBeInTheDocument();
      first.unmount();

      mocks.searchParams = "contactId=c1&address=new";
      render(<NewDealPage />);
      expect(screen.queryByDisplayValue("1 Main")).toBeNull();
      expect(screen.queryByDisplayValue("9 Oak Ave")).toBeNull();
    } finally {
      contact.addresses.pop();
    }
  });
});

describe("NewDealPage — service area on create", () => {
  beforeEach(() => {
    mocks.searchParams = "contactId=c1";
  });

  it("sends the nearest-area fallback id with the job", async () => {
    mocks.effectiveArea = {
      submitId: "a-new-haven",
      source: "nearest",
      area: { id: "a-new-haven", name: "New Haven" },
      distanceMiles: 2180.4,
      isFetching: false,
    };
    const u = user();
    render(<NewDealPage />);
    await pickJobType(u);
    await u.click(submit());
    await waitFor(() => expect(lastDeal()).toMatchObject({ serviceAreaId: "a-new-haven" }));
  });

  it("sends no serviceAreaId when the address resolves on its own", async () => {
    mocks.effectiveArea = { submitId: undefined, source: "resolved", area: { id: "a-hartford", name: "Hartford" }, isFetching: false };
    const u = user();
    render(<NewDealPage />);
    await pickJobType(u);
    await u.click(submit());
    await waitFor(() => expect(mocks.createDeal).toHaveBeenCalled());
    expect(lastDeal().serviceAreaId).toBeUndefined();
  });
});

describe("NewDealPage — job from a call", () => {
  it("prefills the job source from the call, keeps it on the job and links the call", async () => {
    mocks.searchParams = "contactId=c1&callSid=CA1&sourceId=src-google-ads";
    mocks.createDeal.mockImplementation((_b: unknown, opts?: { onSuccess?: (d: unknown) => void }) =>
      opts?.onSuccess?.({ id: "d-new" }),
    );
    const u = user();
    render(<NewDealPage />);
    expect(screen.getByTestId("job-source-select")).toHaveTextContent("src-google-ads");
    await pickJobType(u);
    await u.click(submit());
    await waitFor(() => expect(lastDeal()).toMatchObject({ sourceId: "src-google-ads" }));
    expect(mocks.linkCall).toHaveBeenCalledWith({ sid: "CA1", dealId: "d-new" });
  });
});

describe("NewDealPage — editing the client the job opened with", () => {
  it("opens with the client in the card and their address in the location", () => {
    render(<NewDealPage />);
    expect(clientName()).toHaveValue("Jane Smith");
    expect(screen.getByRole("textbox", { name: "Phone" })).toHaveValue("(404) 555-1234");
    expect(screen.getByLabelText("street")).toHaveValue("1 Main");
    expect(screen.getByRole("link", { name: "Jane Smith" })).toBeInTheDocument();
  });

  it("creates the job straight away when nothing about the client moved", async () => {
    const u = user();
    render(<NewDealPage />);
    await pickJobType(u);
    await u.click(submit());
    expect(screen.queryByText(/before saving the job/i)).not.toBeInTheDocument();
    expect(mocks.createDeal).toHaveBeenCalledTimes(1);
    expect(mocks.updateContact).not.toHaveBeenCalled();
  });

  it("asks who a new name belongs to, and updates the client when it's them", async () => {
    const u = user();
    render(<NewDealPage />);
    await u.clear(clientName());
    await u.type(clientName(), "Janet Smith");
    await u.keyboard("{Escape}");
    await pickJobType(u);
    await u.click(submit());

    expect(screen.getByText(/before saving the job/i)).toBeInTheDocument();
    expect(mocks.createDeal).not.toHaveBeenCalled();
    await u.click(screen.getByRole("button", { name: /save job/i }));
    expect(mocks.updateContact.mock.calls[0][0]).toMatchObject({ id: "c1", body: { firstName: "Janet", lastName: "Smith" } });
    expect(mocks.createDeal).toHaveBeenCalledTimes(1);
  });

  it("makes a separate client, and gives the job to them, when it's somebody else", async () => {
    const u = user();
    render(<NewDealPage />);
    await u.clear(clientName());
    await u.type(clientName(), "Janet Smith");
    await u.keyboard("{Escape}");
    await pickJobType(u);
    await u.click(submit());
    await u.click(screen.getByRole("radio", { name: /a different client/i }));
    await u.click(screen.getByRole("button", { name: /save job/i }));

    expect(mocks.createContact.mock.calls[0][0]).toMatchObject({
      firstName: "Janet",
      phones: ["+14045551234"],
      reassignPhones: true,
    });
    expect(mocks.updateContact).not.toHaveBeenCalled();
    expect(mocks.createDeal).not.toHaveBeenCalled();
  });

  it("writes a new email or company straight to the client, without asking", async () => {
    mocks.createCompany.mockImplementation((_b: unknown, opts?: { onSuccess?: (c: unknown) => void }) =>
      opts?.onSuccess?.({ id: "co-9", title: "Globex" }),
    );
    const u = user();
    render(<NewDealPage />);
    await u.type(screen.getByRole("textbox", { name: "Email" }), "jane@example.com");
    await u.type(screen.getByRole("textbox", { name: "Company name" }), "Globex");
    await pickJobType(u);
    await u.click(submit());
    expect(screen.queryByText(/before saving the job/i)).not.toBeInTheDocument();
    expect(mocks.updateContact.mock.calls[0][0]).toMatchObject({
      id: "c1",
      body: { emails: ["jane@example.com"], companyId: "co-9", type: ContactType.COMPANY_REPRESENTATIVE },
    });
    expect(mocks.createDeal).toHaveBeenCalledTimes(1);
  });

  it("asks about an address the client doesn't have, and can keep it off their record", async () => {
    const u = user();
    render(<NewDealPage />);
    await u.clear(screen.getByLabelText("street"));
    await u.type(screen.getByLabelText("street"), "77 Oak");
    await pickJobType(u);
    await u.click(submit());

    expect(screen.getByText(/77 Oak/)).toBeInTheDocument();
    await u.click(screen.getByRole("radio", { name: /this job only/i }));
    await u.click(screen.getByRole("button", { name: /save job/i }));
    expect(lastDeal()).toMatchObject({ address: { street: "77 Oak" } });
    expect(mocks.updateContact).not.toHaveBeenCalled();
  });

  it("saves a new address onto the client when asked to keep it", async () => {
    const u = user();
    render(<NewDealPage />);
    await u.clear(screen.getByLabelText("street"));
    await u.type(screen.getByLabelText("street"), "77 Oak");
    await pickJobType(u);
    await u.click(submit());
    await u.click(screen.getByRole("button", { name: /save job/i }));
    expect(mocks.updateContact.mock.calls[0][0].body.addresses).toHaveLength(2);
  });
});

describe("NewDealPage — company (business profile)", () => {
  beforeEach(() => {
    mocks.searchParams = "contactId=c1";
  });
  const areaWith = (defaultBusinessProfileId?: string) => ({
    submitId: undefined,
    source: "resolved",
    area: { id: "a1", name: "Hartford", defaultBusinessProfileId },
    isFetching: false,
  });

  it("starts with the default company and sends it on create", async () => {
    const u = user();
    render(<NewDealPage />);
    expect(screen.getByTestId("company-select")).toHaveTextContent("bp-default");
    await pickJobType(u);
    await u.click(submit());
    await waitFor(() => expect(lastDeal()).toMatchObject({ businessProfileId: "bp-default" }));
  });

  it("uses the service area's default company", () => {
    mocks.effectiveArea = areaWith("bp-area");
    render(<NewDealPage />);
    expect(screen.getByTestId("company-select")).toHaveTextContent("bp-area");
  });

  it("?companyId= (from a call) wins over the area default", async () => {
    mocks.searchParams = "contactId=c1&companyId=bp-2";
    mocks.effectiveArea = areaWith("bp-area");
    const u = user();
    render(<NewDealPage />);
    expect(screen.getByTestId("company-select")).toHaveTextContent("bp-2");
    await pickJobType(u);
    await u.click(submit());
    await waitFor(() => expect(lastDeal()).toMatchObject({ businessProfileId: "bp-2" }));
  });

  it("a hand-picked company isn't overwritten when the area changes", async () => {
    const u = user();
    const { rerender } = render(<NewDealPage />);
    await u.click(screen.getByRole("button", { name: /pick company/i }));
    mocks.effectiveArea = areaWith("bp-area");
    rerender(<NewDealPage />);
    expect(screen.getByTestId("company-select")).toHaveTextContent("bp-picked");
    await pickJobType(u);
    await u.click(submit());
    await waitFor(() => expect(lastDeal()).toMatchObject({ businessProfileId: "bp-picked" }));
  });
});

describe("NewDealPage — leaving with unsaved work", () => {
  it("asks before following a link once something was typed", async () => {
    const u = user();
    render(<NewDealPage />);
    await u.type(screen.getByRole("textbox", { name: "Job name" }), "x");
    await u.click(screen.getByRole("link", { name: "Add a custom field" }));
    expect(await screen.findByRole("alertdialog")).toBeInTheDocument();
    expect(mocks.push).not.toHaveBeenCalled();
  });
});
