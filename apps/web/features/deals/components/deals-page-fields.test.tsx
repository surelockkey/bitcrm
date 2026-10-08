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
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/deals",
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@/features/auth/use-permissions", () => ({
  useDenied: () => () => false,
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
  useUserMap: () => ({ map: new Map(), isLoading: false }),
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
  useJobTypesLoading: () => false,
  activeJobTypes: () => [],
  useJobTypeName: () => () => "Lockout",
}));
vi.mock("@/features/job-tags/hooks", () => ({ useJobTags: () => ({ data: [] }) }));
vi.mock("@/features/job-tags/lib", () => ({ activeJobTags: () => [], tagSolidClasses: () => "" }));
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


const openFilter = () => fireEvent.mouseDown(screen.getByRole("combobox", { name: "Filter results" }));

beforeEach(() => {
  localStorage.clear();
  useJobFieldsStore.setState({ visible: { ...DEFAULT_VISIBLE }, order: [] });
});

/**
 * Workiz sorts by a column header, never from Filter results (audit L14):
 * the order is the Scheduled header's, shown by its bar, not as a chip.
 */
describe("DealsPage sorting — the Scheduled header only", () => {
  it("offers no sort in Filter results, and the header's order leaves no chip", () => {
    render(<DealsPage />);
    openFilter();
    expect(screen.queryByRole("listbox", { name: "Sort" })).toBeNull();
    expect(screen.queryByRole("option", { name: "Latest hour first" })).toBeNull();
    fireEvent.keyDown(screen.getByRole("combobox", { name: "Filter results" }), { key: "Escape" });
    fireEvent.click(screen.getByRole("button", { name: /Sort by Scheduled/ }));
    expect(lastPageParams()).toMatchObject({ dir: "desc" });
    expect(screen.queryByText(/^sort:/)).toBeNull();
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

  it("the day range under SCHEDULED is the visit-date window the server is asked for", () => {
    render(<DealsPage />);
    expect(screen.queryByLabelText("Date basis")).not.toBeInTheDocument();

    openFilter();
    fireEvent.change(screen.getByLabelText("From day"), { target: { value: "2026-08-18" } });
    expect(lastPageParams()).toMatchObject({ scheduledFrom: "2026-08-18", scheduledTo: "2026-08-18" });
    fireEvent.change(screen.getByLabelText("To day"), { target: { value: "2026-08-20" } });
    expect(lastPageParams()).toMatchObject({ scheduledFrom: "2026-08-18", scheduledTo: "2026-08-20" });
    expect(screen.getByText("scheduled: Aug 18 – Aug 20")).toBeInTheDocument();
  });

  it("offers only Today as a one-click range — a job board has no past to filter", () => {
    render(<DealsPage />);
    openFilter();
    fireEvent.click(screen.getByRole("button", { name: "Today" }));
    expect(lastPageParams()).toMatchObject({ scheduledFrom: "2026-08-27", scheduledTo: "2026-08-27" });
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
      { ...deal, id: "d1", dealNumber: "A11111", scheduledDate: "2026-08-27", scheduledTimeSlot: "09:00-10:00", jobTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone },
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
        jobTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      },
    ];
    render(<DealsPage />);

    openFilter();
    fireEvent.click(screen.getByRole("option", { name: "Done" }));
    expect(screen.getByText(/A11111/)).toBeInTheDocument();
    expect(screen.queryByText("3 hours ago")).not.toBeInTheDocument();
  });
});

describe("DealsPage fields visibility", () => {
  it("shows the Fields button in the toolbar", () => {
    render(<DealsPage />);
    expect(screen.getByRole("button", { name: /fields/i })).toBeInTheDocument();
  });

  it("unticking a field hides its column once the fields are saved", async () => {
    const u = userEvent.setup();
    render(<DealsPage />);
    expect(screen.getByRole("columnheader", { name: "Tags" })).toBeInTheDocument();

    await u.click(screen.getByRole("button", { name: /fields/i }));
    await u.click(screen.getByRole("checkbox", { name: "Tags" }));
    await u.click(screen.getByRole("button", { name: "Save fields" }));

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
    await u.type(screen.getByPlaceholderText("Type field name here"), "gate");
    expect(screen.getByRole("checkbox", { name: "Gate Code" })).toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: "Source" })).toBeNull();
  });

  it("ticking a custom field adds its column with the deal's answer", async () => {
    const u = userEvent.setup();
    render(<DealsPage />);

    await u.click(screen.getByRole("button", { name: /fields/i }));
    await u.click(screen.getByRole("checkbox", { name: "Gate Code" }));
    await u.click(screen.getByRole("button", { name: "Save fields" }));

    expect(screen.getByRole("columnheader", { name: "Gate Code" })).toBeInTheDocument();
    expect(screen.getByText("4417")).toBeInTheDocument();
  });

  it("hidden fields survive a reload", async () => {
    const u = userEvent.setup();
    const first = render(<DealsPage />);
    await u.click(screen.getByRole("button", { name: /fields/i }));
    await u.click(screen.getByRole("checkbox", { name: "Scheduled" }));
    await u.click(screen.getByRole("button", { name: "Save fields" }));
    first.unmount();

    // Simulate the reload: memory is wiped but the disk survives. Resetting
    // the store also rewrites storage (persist middleware), so snapshot the
    // stored value first and put it back before rehydrating — exactly the
    // state a fresh module load would boot from.
    const saved = localStorage.getItem("bitcrm.jobs-fields")!;
    expect(saved).toContain('"scheduled":false');
    useJobFieldsStore.setState({ visible: { ...DEFAULT_VISIBLE }, order: [] });
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

  it("narrows the list to one company — as a server parameter, from Filter results", () => {
    render(<DealsPage />);
    expect(lastPageParams()).not.toHaveProperty("businessProfileIds");
    openFilter();
    fireEvent.click(screen.getByRole("option", { name: "KeyPro" }));
    // An any-of list, like every Filter results group.
    expect(lastPageParams()).toMatchObject({ businessProfileIds: "bp-2" });
    expect(screen.getByText("company: KeyPro")).toBeInTheDocument();
  });
});
