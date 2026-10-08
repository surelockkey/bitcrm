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
  /** What `/deals/counts` answers when asked with `q`; and every searched count asked for. */
  searchedCounts: {} as Record<string, number | null>,
  searchedCountsParams: [] as unknown[],
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
  useDealCounts: (params: Record<string, unknown>, enabled = true) => {
    if (!enabled) return { data: undefined, isLoading: false, isPlaceholderData: false };
    if ("q" in params) {
      mocks.searchedCountsParams.push(params);
      return { data: mocks.searchedCounts, isLoading: false, isPlaceholderData: false };
    }
    mocks.countsParams.push(params);
    return { data: mocks.counts, isLoading: false, isPlaceholderData: false };
  },
  useUserMap: (ids?: string[]) => {
    mocks.userMapIds.push(ids);
    return { map: new Map(), isLoading: mocks.directoryLoading };
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
vi.mock("@/features/job-tags/hooks", () => ({
  useJobTags: () => ({
    data: [
      { id: "g1", name: "Needs a call", color: "blue", active: true, priority: 0 },
      { id: "g2", name: "Pics attached", color: "amber", active: true, priority: 0 },
    ],
  }),
}));
vi.mock("@/features/job-tags/lib", () => ({ activeJobTags: (tags?: unknown[]) => tags ?? [], tagSolidClasses: () => "" }));
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
  mocks.searchedCounts = {};
  mocks.searchedCountsParams = [];
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

  it("the Scheduled header flips the server direction, and back", () => {
    render(<DealsPage />);
    fireEvent.click(screen.getByRole("button", { name: /Sort by Scheduled/ }));
    expect(lastPageParams()).toMatchObject({ dir: "desc" });
    fireEvent.click(screen.getByRole("button", { name: /Sort by Scheduled/ }));
    expect(lastPageParams()).toMatchObject({ dir: "asc" });
  });

  /** Workiz closes its menu on a pick (react-select closeMenuOnSelect) — audit L12. */
  it("picking an option closes the menu", () => {
    render(<DealsPage />);
    openFilter();
    expect(screen.getByRole("listbox", { name: "Techs" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("option", { name: "t1" }));
    expect(screen.queryByRole("listbox", { name: "Techs" })).toBeNull();
    expect(screen.getByText("user: t1")).toBeInTheDocument();
  });

  /** Audit L8/L15: "Showing 1 to 29 of 29 · Page 1 of 1" must not offer a page 2. */
  it("Next rests on the counted last page, even with a cursor in hand", () => {
    mocks.hasNextPage = true;
    mocks.counts = { ...mocks.counts, submitted: 2 };
    render(<DealsPage />);
    expect(screen.getByText("Page 1 of 1")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Next page" })).toBeDisabled();
  });

  it("the hour window travels as parameters; so does what is typed in Search, as q", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    render(<DealsPage />);
    openFilter();
    fireEvent.change(screen.getByLabelText("From hour"), { target: { value: "08:00" } });
    fireEvent.change(screen.getByLabelText("To hour"), { target: { value: "12:00" } });
    expect(lastPageParams()).toMatchObject({ hourFrom: "08:00", hourTo: "12:00" });
    fireEvent.change(screen.getByRole("textbox", { name: "Search" }), { target: { value: "862n5b" } });
    // Workiz waits ~300ms after the last key.
    expect(lastPageParams()).not.toHaveProperty("q");
    await act(async () => {
      vi.advanceTimersByTime(350);
    });
    expect(lastPageParams()).toMatchObject({ q: "862n5b", hourFrom: "08:00", hourTo: "12:00", superStatus: "submitted" });
    expect(lastPageParams()).not.toHaveProperty("search");
  });

  it("“Show unpaid jobs” asks the list and the counts for unpaid=true", () => {
    render(<DealsPage />);
    fireEvent.click(screen.getByRole("checkbox", { name: "Show unpaid jobs" }));
    expect(lastPageParams()).toMatchObject({ unpaid: true });
    expect(mocks.countsParams[mocks.countsParams.length - 1]).toEqual({ unpaid: true });
  });

  /** Workiz: two techs picked → jobs of either (OR inside a group), each its own chip. */
  it("techs picked in Filter results add up as an any-of list, each a chip", () => {
    render(<DealsPage />);
    openFilter();
    fireEvent.click(screen.getByRole("option", { name: "t1" }));
    expect(lastPageParams()).toMatchObject({ techIds: "t1" });
    expect(lastPageParams()).not.toHaveProperty("techId");
    expect(screen.getByText("user: t1")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Remove user: t1" }));
    expect(lastPageParams()).not.toHaveProperty("techIds");
  });

  it("two tags picked travel as tagIds with tagMatch=any", () => {
    render(<DealsPage />);
    openFilter();
    fireEvent.click(screen.getByRole("option", { name: "Needs a call" }));
    openFilter();
    fireEvent.click(screen.getByRole("option", { name: "Pics attached" }));
    expect(lastPageParams()).toMatchObject({ tagIds: "g1,g2", tagMatch: "any" });
    expect(mocks.countsParams[mocks.countsParams.length - 1]).toMatchObject({ tagIds: "g1,g2", tagMatch: "any" });
    expect(screen.getByText("tag: Needs a call")).toBeInTheDocument();
    expect(screen.getByText("tag: Pics attached")).toBeInTheDocument();
  });
});

/**
 * Workiz searches on the server, inside the open tab and the filters, and
 * counts only the open tab under the search (jobslist_wz_search_Dustin:
 * "Submitted 1 · In Progress 6 · Pending 338").
 */
describe("DealsPage — Search, on the server", () => {
  const type = async (text: string) => {
    fireEvent.change(screen.getByRole("textbox", { name: "Search" }), { target: { value: text } });
    await act(async () => {
      vi.advanceTimersByTime(350);
    });
  };

  it("asks the list for q inside the tab, and shows what it answers", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    render(<DealsPage />);
    mocks.pages = [{ data: [{ ...deal, id: "s1", dealNumber: "5TU7ZA" }], pagination: { count: 1 } }];
    mocks.searchedCounts = { ...mocks.counts, submitted: 1, done: null, canceled: null };
    await type("Dustin");
    expect(lastPageParams()).toEqual({ superStatus: "submitted", sort: "schedule", dir: "asc", limit: 50, q: "Dustin" });
    const rows = screen.getAllByRole("row").filter((r) => !r.hasAttribute("aria-hidden")).slice(1);
    expect(rows).toHaveLength(1);
    expect(rows[0].textContent).toContain("5TU7ZA");
  });

  it("counts every tab without q, and the searched number once with it — the open tab shows that one", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    render(<DealsPage />);
    mocks.pages = [{ data: [deal], pagination: { count: 1 } }];
    mocks.searchedCounts = { ...mocks.counts, submitted: 1, pending: 2, done: null, canceled: null };
    await type("Dustin");
    expect(mocks.countsParams[mocks.countsParams.length - 1]).toEqual({});
    expect(mocks.searchedCountsParams[mocks.searchedCountsParams.length - 1]).toEqual({ q: "Dustin" });
    expect(screen.getByRole("tab", { name: /^Submitted/ }).textContent).toBe("Submitted1");
    // The other tabs keep their unsearched numbers.
    expect(screen.getByRole("tab", { name: /^Pending/ }).textContent).toContain("264");
    // The pager counts against the searched number.
    expect(screen.getByText("Showing 1 to 1 of 1 results")).toBeInTheDocument();
    expect(screen.getByText("Page 1 of 1")).toBeInTheDocument();
  });

  it("asks for no searched count while the box is empty", () => {
    render(<DealsPage />);
    expect(mocks.searchedCountsParams).toEqual([]);
  });

  it("an × clears the search; nothing found reads Workiz's way", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    render(<DealsPage />);
    mocks.pages = [{ data: [], pagination: { count: 0 } }];
    mocks.searchedCounts = { ...mocks.counts, submitted: 0 };
    await type("zzqxwv");
    expect(screen.getByText("No Jobs Found")).toBeInTheDocument();
    // Workiz's own wording for nothing found (jobslist_wz_search_zzqxwv).
    expect(screen.getByText("Showing 1 to 0 of 0 results")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Clear search" }));
    expect(screen.getByRole("textbox", { name: "Search" })).toHaveValue("");
  });

  /**
   * A closed status searched without a date window is not counted (null),
   * and its page can come back short with more behind it.
   */
  it("an uncounted, short page says what is on screen and still offers the next page", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    render(<DealsPage />);
    openFilter();
    fireEvent.click(screen.getByRole("option", { name: "Done" }));
    mocks.pages = [{ data: [deal], pagination: { count: 1, nextCursor: "more" } }];
    mocks.hasNextPage = true;
    mocks.searchedCounts = { ...mocks.counts, done: null, canceled: null };
    await type("Dustin");
    expect(lastPageParams()).toMatchObject({ superStatus: "done", q: "Dustin" });
    expect(screen.getByText("Showing 1 to 1 results")).toBeInTheDocument();
    expect(screen.getByText("Page 1")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Next page" }));
    expect(mocks.fetchNextPage).toHaveBeenCalled();
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
