import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
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
import { DEFAULT_VISIBLE } from "../fields";
import { useJobFieldsStore } from "../fields-store";
import { DealsPage } from "./deals-page";

// next/link needs the App Router context; swap it for a plain anchor.
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

vi.mock("@/features/auth/use-permissions", () => ({
  usePermissions: () => ({ can: () => true, isTechnician: false }),
}));

// The page and table read catalogs/data via react-query; pin them all so this
// renders without a QueryClient and focuses on the fields UI.
vi.mock("../hooks", () => ({
  useDeals: () => ({ data: mocks.deals, isLoading: false, isError: false }),
  useContactMap: () => ({ map: mocks.contactMap }),
  useUserMap: () => ({ map: new Map() }),
}));
vi.mock("@/features/job-types/hooks", () => ({ useJobTypes: () => ({ data: [] }) }));
vi.mock("@/features/job-types/lib", () => ({
  activeJobTypes: () => [],
  useJobTypeName: () => () => "Lockout",
}));
vi.mock("@/features/job-tags/hooks", () => ({ useJobTags: () => ({ data: [] }) }));
vi.mock("@/features/job-tags/lib", () => ({ activeJobTags: () => [] }));
vi.mock("@/features/job-tags/components/job-tag-chips", () => ({ JobTagChips: () => null }));
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
vi.mock("@/features/job-sources/lib", () => ({ useJobSourceName: () => () => "—" }));
vi.mock("@/features/job-statuses/lib", () => ({ useJobStatusName: () => () => "—" }));
vi.mock("./deal-quick-view", () => ({ DealQuickView: () => null }));

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
  customFields: { "cf-gate": "4417" },
  status: DealStatus.ACTIVE,
  createdBy: "u1",
  createdAt: "",
  updatedAt: "",
};

const mocks = vi.hoisted(() => ({
  deals: [] as unknown[],
  contactMap: new Map<string, unknown>(),
}));
mocks.deals = [deal];
mocks.contactMap = new Map([[contact.id, contact]]);

beforeEach(() => {
  localStorage.clear();
  useJobFieldsStore.setState({ visible: { ...DEFAULT_VISIBLE } });
});

describe("DealsPage sorting", () => {
  it("sorts the table by day and by hour from the toolbar select", () => {
    mocks.deals = [
      { ...deal, id: "d1", dealNumber: "A11111", scheduledDate: "2026-08-20", scheduledTimeSlot: "14:00-15:00" },
      { ...deal, id: "d2", dealNumber: "B22222", scheduledDate: "2026-08-18", scheduledTimeSlot: "08:00-09:00" },
    ];
    render(<DealsPage />);

    const firstDataRow = () => screen.getAllByRole("row")[1];
    expect(firstDataRow().textContent).toContain("A11111");

    fireEvent.change(screen.getByRole("combobox", { name: "Sort jobs" }), {
      target: { value: "day_asc" },
    });
    expect(firstDataRow().textContent).toContain("B22222");

    fireEvent.change(screen.getByRole("combobox", { name: "Sort jobs" }), {
      target: { value: "hour_desc" },
    });
    expect(firstDataRow().textContent).toContain("A11111");
    mocks.deals = [deal];
  });
});

describe("DealsPage day/hour ranges", () => {
  afterEach(() => {
    mocks.deals = [deal];
  });

  it("the By: switch drives the day range — schedule vs created", () => {
    // Midday-UTC createdAt keeps the local day stable across timezones.
    mocks.deals = [
      { ...deal, id: "d1", dealNumber: "A11111", scheduledDate: "2026-08-18", createdAt: "2026-08-10T12:00:00.000Z" },
      { ...deal, id: "d2", dealNumber: "B22222", scheduledDate: "2026-08-10", createdAt: "2026-08-18T12:00:00.000Z" },
    ];
    render(<DealsPage />);

    const dayButton = (day: string) =>
      screen.getAllByRole("button", { name: day }).find((b) => b.classList.contains("size-8"))!;
    // Pick Aug 18 as a same-day range.
    fireEvent.click(screen.getByRole("button", { name: "Days" }));
    fireEvent.click(dayButton("18"));
    fireEvent.click(dayButton("18"));

    // Default basis = Job date: the job scheduled on the 18th (A).
    expect(screen.getByText(/A11111/)).toBeInTheDocument();
    expect(screen.queryByText(/B22222/)).not.toBeInTheDocument();

    // Switch to Job created: now the job created on the 18th (B) shows instead.
    fireEvent.change(screen.getByLabelText("Date basis"), { target: { value: "createdAt" } });
    expect(screen.getByText(/B22222/)).toBeInTheDocument();
    expect(screen.queryByText(/A11111/)).not.toBeInTheDocument();
  });

  it("narrows the table by a day range and an hour range", () => {
    mocks.deals = [
      { ...deal, id: "d1", dealNumber: "A11111", scheduledDate: "2026-08-18", scheduledTimeSlot: "08:00-09:00" },
      { ...deal, id: "d2", dealNumber: "B22222", scheduledDate: "2026-08-20", scheduledTimeSlot: "14:00-15:00" },
    ];
    render(<DealsPage />);

    expect(screen.getByText(/A11111/)).toBeInTheDocument();
    expect(screen.getByText(/B22222/)).toBeInTheDocument();

    // One calendar, one range: pick the 18th twice to close a same-day range.
    const dayButton = (day: string) =>
      screen.getAllByRole("button", { name: day }).find((b) => b.classList.contains("size-8"))!;
    fireEvent.click(screen.getByRole("button", { name: "Days" }));
    fireEvent.click(dayButton("18"));
    fireEvent.click(dayButton("18"));
    expect(screen.getByText(/A11111/)).toBeInTheDocument();
    expect(screen.queryByText(/B22222/)).not.toBeInTheDocument();

    // …reset days, then the hour range keeps only the afternoon job.
    fireEvent.click(screen.getByRole("button", { name: "Clear date filter" }));
    fireEvent.change(screen.getByLabelText("From hour"), { target: { value: "12:00" } });
    expect(screen.queryByText(/A11111/)).not.toBeInTheDocument();
    expect(screen.getByText(/B22222/)).toBeInTheDocument();
  });
});

describe("DealsPage fields visibility", () => {
  it("shows the Fields button in the toolbar", () => {
    render(<DealsPage />);
    expect(screen.getByRole("button", { name: /fields/i })).toBeInTheDocument();
  });

  it("unchecking a field hides its column immediately", async () => {
    const u = userEvent.setup();
    render(<DealsPage />);
    expect(screen.getByRole("columnheader", { name: "Tags" })).toBeInTheDocument();

    await u.click(screen.getByRole("button", { name: /fields/i }));
    await u.click(screen.getByRole("checkbox", { name: "Tags" }));
    // The modal panel hides the page from the a11y tree while open.
    await u.keyboard("{Escape}");

    expect(screen.queryByRole("columnheader", { name: "Tags" })).toBeNull();
    expect(screen.getByRole("columnheader", { name: "Client" })).toBeInTheDocument();
  });

  it("lists every deal field in the panel, searchable, grouped by used/unselected", async () => {
    const u = userEvent.setup();
    render(<DealsPage />);

    await u.click(screen.getByRole("button", { name: /fields/i }));
    expect(screen.getByText("Used fields")).toBeInTheDocument();
    expect(screen.getByText("Unselected fields")).toBeInTheDocument();
    // Any deal field is offered, not just the classic columns.
    expect(screen.getByRole("checkbox", { name: "Source" })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "PO number" })).toBeInTheDocument();

    // Search narrows the list.
    await u.type(screen.getByPlaceholderText(/search fields/i), "gate");
    expect(screen.getByRole("checkbox", { name: "Gate Code" })).toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: "Source" })).toBeNull();
  });

  it("toggling a custom field on adds its column with the deal's answer", async () => {
    const u = userEvent.setup();
    render(<DealsPage />);

    await u.click(screen.getByRole("button", { name: /fields/i }));
    await u.click(screen.getByRole("checkbox", { name: "Gate Code" }));
    await u.keyboard("{Escape}");

    expect(screen.getByRole("columnheader", { name: "Gate Code" })).toBeInTheDocument();
    expect(screen.getByText("4417")).toBeInTheDocument();
  });

  it("hidden fields survive a reload", async () => {
    const u = userEvent.setup();
    const first = render(<DealsPage />);
    await u.click(screen.getByRole("button", { name: /fields/i }));
    await u.click(screen.getByRole("checkbox", { name: "Scheduled" }));
    first.unmount();

    // Simulate the reload: memory is wiped but the disk survives. Resetting
    // the store also rewrites storage (persist middleware), so snapshot the
    // stored value first and put it back before rehydrating — exactly the
    // state a fresh module load would boot from.
    const saved = localStorage.getItem("bitcrm.jobs-fields")!;
    expect(saved).toContain('"scheduled":false');
    useJobFieldsStore.setState({ visible: { ...DEFAULT_VISIBLE } });
    localStorage.setItem("bitcrm.jobs-fields", saved);
    await useJobFieldsStore.persist.rehydrate();

    render(<DealsPage />);
    expect(screen.queryByRole("columnheader", { name: "Scheduled" })).toBeNull();
    expect(screen.getByRole("columnheader", { name: "Client" })).toBeInTheDocument();
  });
});
