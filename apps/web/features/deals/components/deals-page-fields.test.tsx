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
  useDealsPage: (params: unknown) => ({
    ...(mocks.pageParams.push(params) && {}),
    data: { pages: [{ data: mocks.deals, pagination: { count: mocks.deals.length } }], pageParams: [] },
    isLoading: false,
    isError: false,
    isFetching: false,
    isFetchingNextPage: false,
    hasNextPage: false,
    fetchNextPage: vi.fn(),
    refetch: vi.fn(),
  }),
  useDealCounts: () => ({ data: mocks.counts, isLoading: false }),
  useUserMap: () => ({ map: new Map() }),
}));
vi.mock("@/features/clients/hooks", () => ({
  useContactsByIds: () => ({ map: mocks.contactMap, isLoading: false }),
}));
vi.mock("@/features/technicians/hooks", () => ({
  useAllTechnicians: () => ({ profiles: [], isLoading: false }),
}));
vi.mock("@/features/service-areas/hooks", () => ({ useServiceAreas: () => ({ data: [] }) }));
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
vi.mock("@/features/external-companies/lib", () => ({ useExternalCompanyName: () => () => "—" }));
vi.mock("@/features/job-sources/lib", () => ({ useJobSourceName: () => () => "—" }));
vi.mock("@/features/job-statuses/lib", () => ({ useJobStatusName: () => () => "—" }));
vi.mock("./deal-quick-view", () => ({ DealQuickView: () => null }));
vi.mock("@/features/business-profiles/hooks", () => ({
  useBusinessProfiles: () => ({
    data: [
      { id: "bp-default", name: "SureLock", isDefault: true, active: true },
      { id: "bp-2", name: "KeyPro", isDefault: false, active: true },
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
  counts: { submitted: 1, in_progress: 0, pending: 0, done_pending_approval: 0, done: 1, canceled: 0, unscheduled: 0 } as Record<
    string,
    number | null
  >,
  pageParams: [] as unknown[],
}));
const lastPageParams = () => mocks.pageParams[mocks.pageParams.length - 1] as Record<string, unknown>;
mocks.deals = [deal];
mocks.contactMap = new Map([[contact.id, contact]]);

beforeEach(() => {
  localStorage.clear();
  useJobFieldsStore.setState({ visible: { ...DEFAULT_VISIBLE } });
});

// Ordering and the day / hour windows are the server's now (see
// deals-page-paging.test.tsx for what the page asks for); the hour sorts
// are the one thing still settled on the page.
describe("DealsPage hour sort — settled within the loaded rows", () => {
  afterEach(() => {
    mocks.deals = [deal];
  });

  it("Hour ↓ puts the later slot first", () => {
    mocks.deals = [
      { ...deal, id: "d1", dealNumber: "A11111", scheduledDate: "2026-08-18", scheduledTimeSlot: "07:00-08:00" },
      { ...deal, id: "d2", dealNumber: "B22222", scheduledDate: "2026-08-18", scheduledTimeSlot: "15:00-16:00" },
    ];
    render(<DealsPage />);
    fireEvent.change(screen.getByRole("combobox", { name: "Sort jobs" }), { target: { value: "hour_desc" } });
    expect(screen.getAllByRole("row")[1].textContent).toContain("B22222");
  });
});

describe("DealsPage date filtering — schedule only", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date("2026-08-27T12:00:00"));
  });
  afterEach(() => {
    vi.useRealTimers();
    mocks.deals = [deal];
  });

  it("has no date-basis switch — the day range is the visit-date window the server is asked for", () => {
    render(<DealsPage />);

    expect(screen.queryByLabelText("Date basis")).not.toBeInTheDocument();

    const dayButton = (day: string) =>
      screen.getAllByRole("button", { name: day }).find((b) => b.classList.contains("size-8"))!;
    fireEvent.click(screen.getByRole("button", { name: "Days" }));
    fireEvent.click(dayButton("18"));
    fireEvent.click(dayButton("18"));

    expect(lastPageParams()).toMatchObject({ scheduledFrom: "2026-08-18", scheduledTo: "2026-08-18" });
  });

  it("offers only Today as a one-click range — a job board has no past to filter", () => {
    render(<DealsPage />);

    fireEvent.click(screen.getByRole("button", { name: "Days" }));
    expect(screen.getByRole("button", { name: "All time" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Today" })).toBeInTheDocument();
    for (const label of ["Yesterday", "Last 7 days", "Last 30 days", "This month", "Last month", "This year"]) {
      expect(screen.queryByRole("button", { name: label })).not.toBeInTheDocument();
    }
  });

});

describe("DealsPage overdue marker", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date("2026-08-27T12:00:00"));
  });
  afterEach(() => {
    vi.useRealTimers();
    mocks.deals = [deal];
  });

  it("shows how long ago a passed slot was, Workiz-style", () => {
    mocks.deals = [
      { ...deal, id: "d1", dealNumber: "A11111", scheduledDate: "2026-08-27", scheduledTimeSlot: "09:00-10:00" },
    ];
    render(<DealsPage />);

    expect(screen.getByText("3 hours ago")).toBeInTheDocument();
  });

  it("keeps closed jobs quiet even when their slot has passed", () => {
    mocks.deals = [
      {
        ...deal,
        id: "d1",
        dealNumber: "A11111",
        superStatus: JobSuperStatus.DONE,
        scheduledDate: "2026-08-27",
        scheduledTimeSlot: "09:00-10:00",
      },
    ];
    render(<DealsPage />);

    fireEvent.click(screen.getByRole("tab", { name: /^done\s?\d+$/i }));
    expect(screen.getByText(/A11111/)).toBeInTheDocument();
    expect(screen.queryByText("3 hours ago")).not.toBeInTheDocument();
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

describe("DealsPage company filter", () => {
  afterEach(() => {
    mocks.deals = [deal];
  });

  it("narrows the list to one company — as a server parameter", async () => {
    const u = userEvent.setup();
    render(<DealsPage />);
    expect(lastPageParams()).not.toHaveProperty("businessProfileId");
    await u.click(screen.getByRole("combobox", { name: "Company filter" }));
    await u.click(await screen.findByRole("option", { name: "KeyPro" }));
    expect(lastPageParams()).toMatchObject({ businessProfileId: "bp-2" });
  });
});
