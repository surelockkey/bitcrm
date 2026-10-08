/**
 * The jobs page on server paging: it asks for one status in visit order,
 * fifty at a time, shows the tab numbers the server counted, and names the
 * clients of the rows it holds — never the whole table.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { ClientType, DealPriority, DealStatus, JobSuperStatus } from "@bitcrm/types";
import type { Deal } from "@bitcrm/types";
import { DEFAULT_VISIBLE } from "../fields";
import { useJobFieldsStore } from "../fields-store";
import { DealsPage } from "./deals-page";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
const nav = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: nav.push, replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/deals",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/features/auth/use-permissions", () => ({
  useDenied: () => () => false,
  usePermissions: () => ({ can: () => true, isTechnician: false, isLoading: false }),
}));

const mocks = vi.hoisted(() => ({
  pages: [] as {
    data: unknown[];
    pagination: { nextCursor?: string; count: number };
    included?: { technicians: unknown[]; clients: unknown[] };
  }[],
  counts: {} as Record<string, number | null>,
  fetchNextPage: vi.fn(),
  hasNextPage: false,
  pageParams: [] as unknown[],
  countsParams: [] as unknown[],
  /** Every (ids, enabled) the page asked the contacts hook for. */
  contactCalls: [] as { ids: string[]; enabled: boolean }[],
  /** crm has not answered for the contacts yet. */
  contactsLoading: false,
  /** Every id list the page handed the user directory. */
  userMapIds: [] as (string[] | undefined)[],
  /** The directory that never answers — the table must not wait for it. */
  directoryLoading: false,
  /** The jobs query is in flight and has nothing yet — a tab switch. */
  listLoading: false,
  /** What the search service + by-ids answered, per text; and every text asked. */
  searchHits: [] as unknown[],
  searchCalls: [] as { text: string; enabled: boolean }[],
}));

vi.mock("../hooks", () => ({
  useDealsPage: (params: unknown) => {
    mocks.pageParams.push(params);
    return {
      data: mocks.listLoading ? undefined : { pages: mocks.pages, pageParams: [] },
      isLoading: mocks.listLoading,
      isError: false,
      isFetching: mocks.listLoading,
      isFetchingNextPage: false,
      hasNextPage: mocks.hasNextPage,
      fetchNextPage: mocks.fetchNextPage,
      refetch: vi.fn(),
    };
  },
  useDealCounts: (params: unknown) => {
    mocks.countsParams.push(params);
    return { data: mocks.counts, isLoading: false };
  },
  useUserMap: (ids?: string[]) => {
    mocks.userMapIds.push(ids);
    return { map: new Map(), isLoading: mocks.directoryLoading };
  },
  useJobsSearch: (text: string, enabled: boolean) => {
    mocks.searchCalls.push({ text, enabled });
    return {
      data: enabled ? { deals: mocks.searchHits, capped: false } : undefined,
      isError: false,
      isFetching: false,
      refetch: vi.fn(),
    };
  },
}));
vi.mock("@/features/clients/hooks", () => ({
  useContactsByIds: (ids: string[], enabled = true) => {
    mocks.contactCalls.push({ ids, enabled });
    return { map: new Map(), isLoading: enabled && mocks.contactsLoading };
  },
}));
vi.mock("@/features/technicians/hooks", () => ({
  useAllTechnicians: () => ({ profiles: [{ userId: "t1" }], isLoading: false }),
}));
vi.mock("@/features/service-areas/hooks", () => ({
  useServiceAreas: () => ({ data: [{ id: "a1", name: "Phoenix", active: true, timezone: "America/Phoenix" }] }),
}));
vi.mock("@/features/job-types/hooks", () => ({ useJobTypes: () => ({ data: [] }) }));
vi.mock("@/features/job-types/lib", () => ({ useJobTypesLoading: () => false, activeJobTypes: () => [], useJobTypeName: () => () => "Lockout" }));
vi.mock("@/features/job-tags/hooks", () => ({ useJobTags: () => ({ data: [] }) }));
vi.mock("@/features/job-tags/lib", () => ({ activeJobTags: () => [], tagSolidClasses: () => "" }));
vi.mock("@/features/job-tags/components/job-tag-chips", () => ({ JobTagChips: () => null }));
vi.mock("@/features/custom-fields/hooks", () => ({ useCustomFields: () => ({ data: [] }) }));
vi.mock("@/features/external-companies/lib", () => ({ useExternalCompanyName: () => () => "—" }));
vi.mock("@/features/job-sources/lib", () => ({ useJobSourceName: () => () => "—" }));
vi.mock("@/features/job-statuses/lib", () => ({ useJobStatusName: () => () => "—" }));
vi.mock("./deal-quick-view", () => ({ DealQuickView: () => null }));
vi.mock("@/features/business-profiles/hooks", () => ({ useBusinessProfiles: () => ({ data: [] }) }));

const deal: Deal = {
  id: "d1",
  dealNumber: "A11111",
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
  status: DealStatus.ACTIVE,
  createdBy: "u1",
  createdAt: "",
  updatedAt: "",
};

const lastPageParams = () => mocks.pageParams[mocks.pageParams.length - 1] as Record<string, unknown>;
const openFilter = () => fireEvent.mouseDown(screen.getByRole("combobox", { name: "Filter results" }));

beforeEach(() => {
  localStorage.clear();
  useJobFieldsStore.setState({ visible: { ...DEFAULT_VISIBLE }, order: [] });
  mocks.pages = [{ data: [deal, { ...deal, id: "d2", dealNumber: "B22222", contactId: "c2" }], pagination: { count: 2 } }];
  mocks.counts = { submitted: 207, in_progress: 10, pending: 264, done_pending_approval: 186, done: null, canceled: null, unscheduled: 5 };
  mocks.hasNextPage = false;
  mocks.pageParams = [];
  mocks.countsParams = [];
  mocks.contactCalls = [];
  mocks.contactsLoading = false;
  mocks.userMapIds = [];
  mocks.directoryLoading = false;
  mocks.searchHits = [];
  mocks.searchCalls = [];
  nav.push.mockClear();
});
afterEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe("DealsPage — Workiz's frame", () => {
  it("has no title block, but Filter results, Create New, the five tabs, Search and Fields", () => {
    render(<DealsPage />);
    expect(screen.queryByRole("heading", { name: "Jobs" })).toBeNull();
    expect(screen.getByRole("combobox", { name: "Filter results" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Create New/ })).toHaveAttribute("href", "/deals/new");
    expect(screen.getAllByRole("tab").map((t) => t.textContent?.replace(/[\d,—+]+$/, "").trim())).toEqual([
      "Submitted",
      "In Progress",
      "Pending",
      "Done Pending Approval",
      "Unscheduled",
    ]);
    expect(screen.getByRole("textbox", { name: "Search" })).toHaveAttribute("placeholder", "Search");
    expect(screen.getByRole("checkbox", { name: "Show unpaid jobs" })).not.toBeChecked();
    expect(screen.getByRole("button", { name: /Fields/ })).toBeInTheDocument();
  });

  it("a row click opens the job", () => {
    render(<DealsPage />);
    fireEvent.click(screen.getByText("A11111"));
    expect(nav.push).toHaveBeenCalledWith("/deals/d1");
  });
});

describe("DealsPage — what it asks the server for", () => {
  it("opens on Submitted, in visit order, fifty a page", () => {
    render(<DealsPage />);
    expect(lastPageParams()).toEqual({ superStatus: "submitted", sort: "schedule", dir: "asc", limit: 50 });
  });

  it("a tab click changes the status; the Unscheduled tab asks for the undated jobs", () => {
    render(<DealsPage />);
    fireEvent.click(screen.getByRole("tab", { name: /Pending\s*264/ }));
    expect(lastPageParams()).toMatchObject({ superStatus: "pending" });
    fireEvent.click(screen.getByRole("tab", { name: /Unscheduled/ }));
    expect(lastPageParams()).toMatchObject({ unscheduled: true });
    expect(lastPageParams()).not.toHaveProperty("superStatus");
  });

  /**
   * Workiz has no Done or Canceled tab. Ours stay reachable through Filter
   * results → STATUS, as a chip; a tab click puts the list back on a tab.
   */
  it("Done and Canceled are reached through Filter results, and a tab click leaves them", () => {
    render(<DealsPage />);
    openFilter();
    fireEvent.click(screen.getByRole("option", { name: "Canceled" }));
    expect(lastPageParams()).toMatchObject({ superStatus: "canceled" });
    expect(screen.getByText("status: Canceled")).toBeInTheDocument();
    expect(screen.getAllByRole("tab").every((t) => t.getAttribute("aria-selected") === "false")).toBe(true);

    fireEvent.click(screen.getByRole("tab", { name: /Submitted/ }));
    expect(lastPageParams()).toMatchObject({ superStatus: "submitted" });
    expect(screen.queryByText("status: Canceled")).toBeNull();
  });

  it("the Scheduled header flips the server direction; Sort → hour reorders the loaded rows", () => {
    mocks.pages = [
      {
        data: [
          { ...deal, id: "d1", dealNumber: "A11111", scheduledDate: "2026-08-18", scheduledTimeSlot: "08:00-09:00" },
          { ...deal, id: "d2", dealNumber: "B22222", scheduledDate: "2026-08-18", scheduledTimeSlot: "15:00-16:00" },
        ],
        pagination: { count: 2 },
      },
    ];
    render(<DealsPage />);
    fireEvent.click(screen.getByRole("button", { name: /Sort by Scheduled/ }));
    expect(lastPageParams()).toMatchObject({ dir: "desc" });
    openFilter();
    fireEvent.click(screen.getByRole("option", { name: "Latest hour first" }));
    expect(lastPageParams()).toMatchObject({ dir: "asc" });
    expect(screen.getAllByRole("row")[1].textContent).toContain("B22222");
  });

  it("the hour window travels as parameters; so does a job code typed in Search", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    render(<DealsPage />);
    openFilter();
    fireEvent.change(screen.getByLabelText("From hour"), { target: { value: "08:00" } });
    fireEvent.change(screen.getByLabelText("To hour"), { target: { value: "12:00" } });
    expect(lastPageParams()).toMatchObject({ hourFrom: "08:00", hourTo: "12:00" });
    fireEvent.change(screen.getByRole("textbox", { name: "Search" }), { target: { value: "862n5b" } });
    // Workiz waits ~300ms after the last key.
    expect(lastPageParams()).not.toHaveProperty("search");
    await act(async () => {
      vi.advanceTimersByTime(350);
    });
    expect(lastPageParams()).toMatchObject({ search: "862N5B" });
  });

  it("“Show unpaid jobs” asks the list and the counts for unpaid=true", () => {
    render(<DealsPage />);
    fireEvent.click(screen.getByRole("checkbox", { name: "Show unpaid jobs" }));
    expect(lastPageParams()).toMatchObject({ unpaid: true });
    expect(mocks.countsParams[mocks.countsParams.length - 1]).toEqual({ unpaid: true });
  });

  it("a tech picked in Filter results is a server parameter, shown as a chip", () => {
    render(<DealsPage />);
    openFilter();
    fireEvent.click(screen.getByRole("option", { name: "t1" }));
    expect(lastPageParams()).toMatchObject({ techId: "t1" });
    expect(screen.getByText("user: t1")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Remove user: t1" }));
    expect(lastPageParams()).not.toHaveProperty("techId");
  });
});

/**
 * Free text: the search service finds candidates across every job; the page
 * keeps those on its tab that match the Workiz way.
 */
describe("DealsPage — Search across every job", () => {
  it("free text goes to the search service, not the list; the hits on the tab are shown", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mocks.searchHits = [
      { ...deal, id: "s1", dealNumber: "S11111", address: { street: "1 Main", city: "Princeton", state: "TX", zip: "1" } },
      { ...deal, id: "s2", dealNumber: "S22222", superStatus: JobSuperStatus.PENDING, address: { street: "1 Main", city: "Princeton", state: "TX", zip: "1" } },
      // A fuzzy near miss the engine returned: Workiz would not show it.
      { ...deal, id: "s3", dealNumber: "S33333", address: { street: "1 Main", city: "Prince", state: "TX", zip: "1" } },
    ];
    render(<DealsPage />);
    fireEvent.change(screen.getByRole("textbox", { name: "Search" }), { target: { value: "Princeton" } });
    await act(async () => {
      vi.advanceTimersByTime(350);
    });
    expect(mocks.searchCalls[mocks.searchCalls.length - 1]).toEqual({ text: "Princeton", enabled: true });
    expect(lastPageParams()).not.toHaveProperty("search");
    const rows = screen.getAllByRole("row").slice(1);
    expect(rows).toHaveLength(1);
    expect(rows[0].textContent).toContain("S11111");
    // The open tab's chip counts what was found.
    expect(screen.getByRole("tab", { name: /Submitted/ }).textContent).toContain("1");
    expect(screen.getByText("Showing 1 to 1 of 1 results")).toBeInTheDocument();
  });

  it("an × clears the search", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    render(<DealsPage />);
    fireEvent.change(screen.getByRole("textbox", { name: "Search" }), { target: { value: "zzqxwv" } });
    await act(async () => {
      vi.advanceTimersByTime(350);
    });
    expect(screen.getByText("No Jobs Found")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Clear search" }));
    expect(screen.getByRole("textbox", { name: "Search" })).toHaveValue("");
  });
});

describe("DealsPage — tab counts and clients", () => {
  it("shows the server's numbers on the tabs", () => {
    render(<DealsPage />);
    expect(screen.getByRole("tab", { name: /Submitted/ }).textContent).toContain("207");
    expect(screen.getByRole("tab", { name: /Unscheduled/ }).textContent).toContain("5");
    expect(mocks.countsParams[mocks.countsParams.length - 1]).toEqual({});
  });

  it("the counts follow the filters but not the tab", () => {
    render(<DealsPage />);
    openFilter();
    fireEvent.change(screen.getByLabelText("From hour"), { target: { value: "09:00" } });
    fireEvent.click(screen.getByRole("tab", { name: /^Pending/ }));
    expect(mocks.countsParams[mocks.countsParams.length - 1]).toEqual({ hourFrom: "09:00" });
  });

  it("says a number the server stopped counting is a floor", () => {
    mocks.counts = { ...mocks.counts, pending: 10_000, atLeast: ["pending", "total"] } as never;
    render(<DealsPage />);
    expect(screen.getByRole("tab", { name: /^Pending/ }).textContent).toContain("10,000+");
  });

  it("resolves only the contacts of the rows it holds", () => {
    render(<DealsPage />);
    expect(mocks.contactCalls[mocks.contactCalls.length - 1]).toEqual({ ids: ["c1", "c2"], enabled: true });
  });
});

describe("DealsPage — Workiz's pager", () => {
  it("offers the next page when there is one, and asks for it on click", () => {
    mocks.hasNextPage = true;
    render(<DealsPage />);
    fireEvent.click(screen.getByRole("button", { name: "Next page" }));
    expect(mocks.fetchNextPage).toHaveBeenCalled();
  });

  it("says which page of how many — 207 jobs at fifty a page is five", () => {
    mocks.hasNextPage = true;
    render(<DealsPage />);
    expect(screen.getByText("Page 1 of 5")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Previous page" })).toBeDisabled();
  });

  it("the next button rests when the list is complete", () => {
    render(<DealsPage />);
    expect(screen.getByRole("button", { name: "Next page" })).toBeDisabled();
  });

  it("counts the rows on screen against the number the server counted", () => {
    render(<DealsPage />);
    expect(screen.getByText("Showing 1 to 2 of 207 results")).toBeInTheDocument();
  });

  it("the chosen row count is what the server is asked for, and it is remembered", () => {
    const { unmount } = render(<DealsPage />);
    const select = screen.getByRole("combobox", { name: /rows per page/i });
    expect([...select.querySelectorAll("option")].map((o) => o.textContent)).toEqual(["5", "10", "20", "25", "50", "100"]);
    fireEvent.change(select, { target: { value: "100" } });
    expect(lastPageParams()).toMatchObject({ limit: 100 });

    unmount();
    mocks.pageParams = [];
    render(<DealsPage />);
    expect(lastPageParams()).toMatchObject({ limit: 100 });
  });
});

/**
 * Імена приїжджають разом із рядками.
 *
 * `GET /deals` віддає `included` — самі імена, — тож техніки й клієнти
 * названі в тому ж кадрі, що й рядки, без довідника користувачів.
 */
describe("DealsPage — the names that arrive with the rows", () => {
  const tech = { id: "t9", firstName: "Ann", lastName: "Lee" };
  const client = { id: "c1", firstName: "Jane", lastName: "Smith" };

  const withNames = () => {
    mocks.pages = [
      {
        data: [{ ...deal, assignedTechIds: ["t9"] }],
        pagination: { count: 1 },
        included: { technicians: [tech], clients: [client] },
      },
    ];
  };

  it("names the technician and the client while the directory is still in flight", () => {
    withNames();
    mocks.directoryLoading = true;
    render(<DealsPage />);

    expect(screen.queryByRole("status", { name: "Loading jobs" })).toBeNull();
    expect(screen.getByLabelText("Technician")).toHaveTextContent("Ann Lee");
    expect(screen.getByText("Jane Smith")).toBeInTheDocument();
  });

  it("merges the names of every page the pager holds", () => {
    withNames();
    mocks.pages = [
      ...mocks.pages,
      {
        data: [{ ...deal, id: "d2", dealNumber: "B22222", assignedTechIds: ["t8"] }],
        pagination: { count: 1 },
        included: {
          technicians: [{ id: "t8", firstName: "Bob", lastName: "Poole" }],
          clients: [],
        },
      },
    ];
    render(<DealsPage />);

    fireEvent.click(screen.getByRole("button", { name: "Next page" }));
    expect(screen.getAllByRole("row")[1].textContent).toContain("B22222");
    expect(screen.getByLabelText("Technician")).toHaveTextContent("Bob Poole");
    expect(screen.getByText("Jane Smith")).toBeInTheDocument();
  });

  it("asks the directory only about the roster behind the tech filter, never about the rows", () => {
    withNames();
    render(<DealsPage />);
    expect(mocks.userMapIds[mocks.userMapIds.length - 1]).toEqual(["t1"]);
  });
});

/**
 * Workiz prints the client's number under the name, so with the Client
 * column on the page asks crm for the contacts of its rows — and the first
 * frame waits for them, rather than growing a line under every name a beat
 * later.
 */
describe("DealsPage — contacts where a client's number or email is shown", () => {
  it("asks for none when no column shows a client", () => {
    useJobFieldsStore.setState({ visible: { ...DEFAULT_VISIBLE, client: false }, order: [] });
    render(<DealsPage />);
    expect(mocks.contactCalls[mocks.contactCalls.length - 1]?.enabled).toBe(false);
  });

  it("asks for them while the Client column is on", () => {
    render(<DealsPage />);
    expect(mocks.contactCalls[mocks.contactCalls.length - 1]?.enabled).toBe(true);
  });

  it("holds the first frame until they are in", () => {
    mocks.contactsLoading = true;
    render(<DealsPage />);
    expect(screen.getByRole("status", { name: "Loading jobs" })).toBeInTheDocument();
    expect(screen.queryByText("A11111")).toBeNull();
  });
});

/**
 * Перемикання вкладки.
 *
 * Кожна вкладка — свій ключ запиту, тож у неї спершу немає жодного рядка.
 * Засувка першого показу не має це переживати: інакше сторінка провалюється
 * повз скелет одразу в «немає робіт», і читач бачить порожньо, а за мить —
 * роботи. Скелет тієї самої форми чесніший і не рухає верстку.
 */
describe("DealsPage — switching tabs", () => {
  it("shows the table shell, not “no jobs”, while a tab is still loading", async () => {
    mocks.listLoading = true;
    render(<DealsPage />);

    expect(screen.queryByText(/No jobs/i)).toBeNull();
    expect(await screen.findByRole("status", { name: "Loading jobs" })).toBeInTheDocument();
    mocks.listLoading = false;
  });

  it("still says so when a tab has genuinely finished with nothing", async () => {
    mocks.pages = [{ data: [], pagination: { count: 0 } }];
    render(<DealsPage />);

    expect(await screen.findByText(/No jobs/i)).toBeInTheDocument();
    expect(screen.queryByRole("status", { name: "Loading jobs" })).toBeNull();
  });
});
