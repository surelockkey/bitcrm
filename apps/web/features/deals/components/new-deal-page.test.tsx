import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  ContactSource,
  ContactType,
  CrmStatus,
  type Contact,
} from "@bitcrm/types";

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  createDeal: vi.fn(),
  createContact: vi.fn(),
  updateContact: vi.fn(),
  linkCall: vi.fn(),
  customFieldDefs: [] as unknown[],
  requiredFields: {} as Record<string, boolean>,
  searchParams: "contactId=c1&callSid=CA1",
  requestUpload: vi.fn(),
  uploadBytes: vi.fn(),
  updateDealApi: vi.fn(),
  companyMap: new Map<string, { id: string; title: string }>(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push, replace: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(mocks.searchParams),
}));
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

const contact: Contact = {
  id: "c1",
  firstName: "Jane",
  lastName: "Smith",
  phones: ["+14045551234"],
  emails: [],
  addresses: [
    { street: "1 Main", unit: "", city: "Phoenix", state: "AZ", zip: "85001" },
  ],
  type: ContactType.RESIDENTIAL,
  source: ContactSource.PHONE_CALL,
  status: CrmStatus.ACTIVE,
  createdBy: "u1",
  createdAt: "",
  updatedAt: "",
};

vi.mock("@/features/clients/hooks", () => ({
  useContact: (id: string) => ({ data: id ? contact : undefined }),
  useContactByPhone: () => ({ data: null, isFetching: false }),
  useCreateContact: () => ({ mutate: mocks.createContact, isPending: false }),
  useUpdateContact: () => ({ mutate: mocks.updateContact, isPending: false }),
  useCompanyMap: () => ({ map: mocks.companyMap }),
}));
vi.mock("../hooks", () => ({
  useCreateDeal: () => ({ mutate: mocks.createDeal, isPending: false }),
  // The extracted ClientPicker searches the loaded contact book.
  useContactMap: () => ({ map: new Map() }),
}));
vi.mock("@/features/calls/hooks", () => ({
  useLinkCallToDeal: () => ({ mutate: mocks.linkCall, isPending: false }),
}));
vi.mock("@/features/calls/components/calls-to-link", () => ({
  CallsToLink: () => null,
}));
vi.mock("@/features/custom-fields/hooks", () => ({
  useCustomFields: () => ({ data: mocks.customFieldDefs }),
}));
vi.mock("@/features/job-field-settings/hooks", () => ({
  useJobFieldSettings: () => ({ data: { requiredFields: mocks.requiredFields }, isLoading: false }),
}));
vi.mock("../attachments-api", () => ({
  requestAttachmentUpload: (...args: unknown[]) => mocks.requestUpload(...args),
  uploadAttachmentBytes: (...args: unknown[]) => mocks.uploadBytes(...args),
}));
vi.mock("../api", () => ({
  updateDeal: (...args: unknown[]) => mocks.updateDealApi(...args),
}));
vi.mock("@/features/job-tags/components/job-tag-combobox", () => ({ JobTagCombobox: () => null }));
vi.mock("@/features/service-areas/components/resolved-area-field", () => ({
  ResolvedAreaField: () => null,
}));
vi.mock("@/features/job-sources/components/job-source-select", () => ({
  JobSourceSelect: () => null,
}));
vi.mock("@/features/job-types/components/job-type-select", () => ({
  JobTypeSelect: ({ onChange }: { onChange: (v: string) => void }) => (
    <button type="button" onClick={() => onChange("jt-rekey")}>pick job type</button>
  ),
}));
vi.mock("./schedule-field", () => ({ ScheduleField: () => null }));
// The address block is a real form field here — a plain input over street is
// enough to prove the client's address arrives pre-filled and can be replaced.
vi.mock("./deal-address-fields", () => ({
  DealAddressFields: ({
    value,
    onChange,
  }: {
    value?: { street?: string };
    onChange: (a: unknown) => void;
  }) => (
    <input
      aria-label="street"
      value={value?.street ?? ""}
      onChange={(e) =>
        onChange({ street: e.target.value, unit: "", city: "Phoenix", state: "AZ", zip: "85001" })
      }
    />
  ),
}));

import { NewDealPage } from "./new-deal-page";

const user = () => userEvent.setup();
const submit = () => screen.getByRole("button", { name: /create job/i });

describe("NewDealPage — admin-required fields", () => {
  beforeEach(() => {
    mocks.searchParams = "contactId=c1&callSid=CA1";
    mocks.customFieldDefs = [];
    mocks.requiredFields = { source: true };
    mocks.createDeal.mockReset();
  });

  it("blocks Create job and names the empty required field", async () => {
    const u = user();
    render(<NewDealPage />);

    await u.click(screen.getByRole("button", { name: /pick job type/i }));
    await u.click(submit());

    expect(mocks.createDeal).not.toHaveBeenCalled();
    expect(screen.getByText(/Fill required field.*Job source/)).toBeInTheDocument();
  });

  it("marks the required field with an asterisk", () => {
    render(<NewDealPage />);

    const label = screen.getByText("Job source");
    expect(label.textContent).toContain("*");
  });
});

describe("NewDealPage — deferred file uploads", () => {
  beforeEach(() => {
    mocks.searchParams = "contactId=c1&callSid=CA1";
    mocks.requiredFields = {};
    mocks.customFieldDefs = [
      {
        id: "cf-file",
        name: "Check Image Front",
        type: "file",
        group: "Tech",
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
    ];
    mocks.createDeal.mockReset();
    mocks.push.mockReset();
    mocks.requestUpload.mockReset();
    mocks.uploadBytes.mockReset();
    mocks.updateDealApi.mockReset();
  });

  it("holds the picked file and uploads it right after the job is created", async () => {
    mocks.requestUpload.mockResolvedValue({
      id: "att-1",
      uploadUrl: "https://s3/upload",
      s3Key: "k",
      headers: { "Content-Type": "image/jpeg" },
    });
    mocks.uploadBytes.mockResolvedValue(undefined);
    mocks.updateDealApi.mockResolvedValue({});
    mocks.createDeal.mockImplementation(
      (_body: unknown, opts?: { onSuccess?: (d: unknown) => void }) =>
        opts?.onSuccess?.({ id: "d-new" }),
    );

    const u = user();
    const { container } = render(<NewDealPage />);

    // No "save first" nag; the file is picked straight on the form.
    expect(screen.queryByText(/save the job first/i)).not.toBeInTheDocument();
    const file = new File(["bytes"], "check.jpg", { type: "image/jpeg" });
    fireEvent.change(container.querySelector('input[type="file"]')!, {
      target: { files: [file] },
    });
    expect(await screen.findByText("check.jpg")).toBeInTheDocument();

    await u.click(screen.getByRole("button", { name: /pick job type/i }));
    await u.click(screen.getByRole("button", { name: /create job/i }));

    // Chain: job created → bytes uploaded under it → field patched → navigate.
    await waitFor(() =>
      expect(mocks.requestUpload).toHaveBeenCalledWith(
        "d-new",
        expect.objectContaining({ fileName: "check.jpg" }),
      ),
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

describe("NewDealPage — auto-create client", () => {
  beforeEach(() => {
    mocks.searchParams = "";
    mocks.customFieldDefs = [];
    mocks.requiredFields = {};
    mocks.createContact.mockReset();
    mocks.createDeal.mockReset();
  });

  it("creates the client first, then the job under them, in one click", async () => {
    mocks.createContact.mockImplementation(
      (body: { firstName: string; lastName: string }, opts?: { onSuccess?: (c: unknown) => void }) =>
        opts?.onSuccess?.({ ...contact, id: "c-new", firstName: body.firstName, lastName: body.lastName }),
    );
    const u = user();
    render(<NewDealPage />);

    // Nobody matches — the picker opens its new-client block.
    await u.type(screen.getByPlaceholderText(/search by name/i), "Nova Client");
    await u.type(screen.getByPlaceholderText("First name"), "Nova");
    await u.type(screen.getByPlaceholderText("Last name"), "Client");

    await u.type(screen.getByLabelText("street"), "9 Elm");
    await u.click(screen.getByRole("button", { name: /pick job type/i }));
    await u.click(screen.getByRole("button", { name: /create job/i }));

    expect(mocks.createContact).toHaveBeenCalledWith(
      expect.objectContaining({ firstName: "Nova", lastName: "Client" }),
      expect.anything(),
    );
    expect(mocks.createDeal).toHaveBeenCalledWith(
      expect.objectContaining({ contactId: "c-new" }),
      expect.anything(),
    );
  });

  it("keeps Create job disabled until a client is picked or typed", async () => {
    const u = user();
    render(<NewDealPage />);

    expect(submit()).toBeDisabled();

    await u.type(screen.getByPlaceholderText(/search by name/i), "Nova Client");
    await u.type(screen.getByPlaceholderText("First name"), "Nova");
    await u.type(screen.getByPlaceholderText("Last name"), "Client");

    expect(submit()).toBeEnabled();
  });
});

describe("NewDealPage — Workiz layout", () => {
  beforeEach(() => {
    mocks.searchParams = "contactId=c1&callSid=CA1";
    mocks.customFieldDefs = [];
    mocks.requiredFields = {};
  });

  it("lays the form out in Workiz-titled cards", () => {
    render(<NewDealPage />);

    for (const title of ["Client Details", "Service Location", "Job Details", "Scheduled"]) {
      expect(screen.getByText(title)).toBeInTheDocument();
    }
  });

  it("shows a Company name field in the client details", () => {
    mocks.companyMap = new Map([["co-1", { id: "co-1", title: "Acme Storage" }]]);
    render(<NewDealPage />);

    expect(screen.getByText("Company name")).toBeInTheDocument();
    // The resolved contact is residential, so the field reads as empty.
    expect(screen.getByLabelText("Company name")).toBeInTheDocument();
    mocks.companyMap = new Map();
  });

  it("no longer offers a Priority field", () => {
    render(<NewDealPage />);
    expect(screen.queryByText("Priority")).not.toBeInTheDocument();
  });

  it("renders each custom-field group as its own card, Workiz-ordered", () => {
    const def = (id: string, name: string, group: string) => ({
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
    });
    mocks.customFieldDefs = [
      def("cf-t", "Check Image Front", "Tech"),
      def("cf-e", "Jobs Dispatch", "Extra Info"),
    ];
    render(<NewDealPage />);

    const titles = screen.getAllByText(/^(Extra Info|Tech)$/).map((el) => el.textContent);
    // Extra Info comes before Tech, as on the Workiz form.
    expect(titles).toEqual(["Extra Info", "Tech"]);
    expect(screen.getByText("Check Image Front")).toBeInTheDocument();
    expect(screen.getByText("Jobs Dispatch")).toBeInTheDocument();
    // No single monolithic "Custom fields" card anymore.
    expect(screen.queryByText(/^Custom fields$/)).not.toBeInTheDocument();
  });
});

describe("NewDealPage — client details", () => {
  beforeEach(() => {
    mocks.searchParams = "contactId=c1&callSid=CA1";
    mocks.customFieldDefs = [];
    mocks.requiredFields = {};
    for (const m of Object.values(mocks)) {
      if (typeof (m as { mockClear?: () => void }).mockClear === "function") {
        (m as { mockClear: () => void }).mockClear();
      }
    }
  });

  const fillJob = async (u: ReturnType<typeof user>) => {
    await u.click(screen.getByRole("button", { name: /pick job type/i }));
  };

  it("opens with the resolved client editable and their address filled in", () => {
    render(<NewDealPage />);

    expect(screen.getByDisplayValue("Jane")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Smith")).toBeInTheDocument();
    // Their address is the job's starting point — nobody retypes it mid-call.
    expect(screen.getByLabelText("street")).toHaveValue("1 Main");
    // No read-only card standing between the dispatcher and the fields.
    expect(screen.queryByRole("button", { name: /^edit$/i })).not.toBeInTheDocument();
  });

  it("creates the job straight away when nothing about the client moved", async () => {
    const u = user();
    render(<NewDealPage />);

    await fillJob(u);
    await u.click(submit());

    expect(screen.queryByText(/before saving the job/i)).not.toBeInTheDocument();
    expect(mocks.createDeal).toHaveBeenCalledTimes(1);
  });

  it("asks who edited details belong to, and updates the client when they're the same", async () => {
    const u = user();
    render(<NewDealPage />);

    await u.type(screen.getByDisplayValue("Jane"), "t"); // Jane → Janet
    await fillJob(u);
    await u.click(submit());

    expect(screen.getByText(/before saving the job/i)).toBeInTheDocument();
    // Nothing is written until the question is answered.
    expect(mocks.createDeal).not.toHaveBeenCalled();

    await u.click(screen.getByRole("button", { name: /save job/i }));
    expect(mocks.updateContact.mock.calls[0][0]).toMatchObject({
      id: "c1",
      body: { firstName: "Janet" },
    });
    expect(mocks.createDeal).toHaveBeenCalledTimes(1);
  });

  it("makes a separate client, and gives the job to them, when it's somebody else", async () => {
    const u = user();
    render(<NewDealPage />);

    await u.type(screen.getByDisplayValue("Jane"), "t");
    await fillJob(u);
    await u.click(submit());
    await u.click(screen.getByRole("radio", { name: /a different client/i }));
    await u.click(screen.getByRole("button", { name: /save job/i }));

    expect(mocks.createContact.mock.calls[0][0]).toMatchObject({
      firstName: "Janet",
      phones: ["+14045551234"],
      reassignPhones: true,
    });
    expect(mocks.updateContact).not.toHaveBeenCalled();
    // The job waits for the new client's id before it's created.
    expect(mocks.createDeal).not.toHaveBeenCalled();
  });

  it("asks about an address the client doesn't have, and can keep it off their record", async () => {
    const u = user();
    render(<NewDealPage />);

    await u.clear(screen.getByLabelText("street"));
    await u.type(screen.getByLabelText("street"), "77 Oak");
    await fillJob(u);
    await u.click(submit());

    expect(screen.getByText(/77 Oak/)).toBeInTheDocument();
    await u.click(screen.getByRole("radio", { name: /this job only/i }));
    await u.click(screen.getByRole("button", { name: /save job/i }));

    // Job takes the new address; the client's record is untouched.
    expect(mocks.createDeal.mock.calls[0][0]).toMatchObject({
      address: { street: "77 Oak" },
    });
    expect(mocks.updateContact).not.toHaveBeenCalled();
  });

  it("saves a new address onto the client when asked to keep it", async () => {
    const u = user();
    render(<NewDealPage />);

    await u.clear(screen.getByLabelText("street"));
    await u.type(screen.getByLabelText("street"), "77 Oak");
    await fillJob(u);
    await u.click(submit());
    await u.click(screen.getByRole("button", { name: /save job/i }));

    expect(mocks.updateContact.mock.calls[0][0].body.addresses).toHaveLength(2);
  });
});
