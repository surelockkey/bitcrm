import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
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
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push, replace: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams("contactId=c1&callSid=CA1"),
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
  useCompanyMap: () => ({ map: new Map() }),
}));
vi.mock("../hooks", () => ({
  useCreateDeal: () => ({ mutate: mocks.createDeal, isPending: false }),
}));
vi.mock("@/features/calls/hooks", () => ({
  useLinkCallToDeal: () => ({ mutate: mocks.linkCall, isPending: false }),
}));
vi.mock("@/features/calls/components/calls-to-link", () => ({
  CallsToLink: () => null,
}));
vi.mock("@/features/custom-fields/hooks", () => ({ useCustomFields: () => ({ data: [] }) }));
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

describe("NewDealPage — client details", () => {
  beforeEach(() => {
    for (const m of Object.values(mocks)) m.mockClear();
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
