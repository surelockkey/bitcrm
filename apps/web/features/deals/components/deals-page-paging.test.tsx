/**
 * The jobs page on server paging: it asks for one status in visit order,
 * fifty at a time, shows the tab numbers the server counted, and names the
 * clients of the rows it holds — never the whole table.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
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
vi.mock("@/features/auth/use-permissions", () => ({
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
  /** Every id list the page handed the user directory. */
  userMapIds: [] as (string[] | undefined)[],
  /** The directory that never answers — the table must not wait for it. */
  directoryLoading: false,
  /** The jobs query is in flight and has nothing yet — a tab switch. */
  listLoading: false,
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
}));
vi.mock("@/features/clients/hooks", () => ({
  useContactsByIds: (ids: string[], enabled = true) => {
    mocks.contactCalls.push({ ids, enabled });
    return { map: new Map(), isLoading: enabled };
  },
}));
vi.mock("@/features/technicians/hooks", () => ({
  useAllTechnicians: () => ({ profiles: [{ userId: "t1" }], isLoading: false }),
}));
vi.mock("@/features/service-areas/hooks", () => ({
  useServiceAreas: () => ({ data: [{ id: "a1", name: "Phoenix", active: true }] }),
}));
vi.mock("@/features/job-types/hooks", () => ({ useJobTypes: () => ({ data: [] }) }));
vi.mock("@/features/job-types/lib", () => ({ useJobTypesLoading: () => false, activeJobTypes: () => [], useJobTypeName: () => () => "Lockout" }));
vi.mock("@/features/job-tags/hooks", () => ({ useJobTags: () => ({ data: [] }) }));
vi.mock("@/features/job-tags/lib", () => ({ activeJobTags: () => [] }));
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

beforeEach(() => {
  localStorage.clear();
  useJobFieldsStore.setState({ visible: { ...DEFAULT_VISIBLE } });
  mocks.pages = [{ data: [deal, { ...deal, id: "d2", dealNumber: "B22222", contactId: "c2" }], pagination: { count: 2 } }];
  mocks.counts = { submitted: 207, in_progress: 10, pending: 264, done_pending_approval: 186, done: null, canceled: null, unscheduled: 5 };
  mocks.hasNextPage = false;
  mocks.pageParams = [];
  mocks.countsParams = [];
  mocks.contactCalls = [];
  mocks.userMapIds = [];
  mocks.directoryLoading = false;
});
afterEach(() => vi.clearAllMocks());

describe("DealsPage — what it asks the server for", () => {
  it("opens on Submitted, in visit order, fifty a page", () => {
    render(<DealsPage />);
    expect(lastPageParams()).toEqual({ superStatus: "submitted", sort: "schedule", dir: "asc", limit: 50 });
  });

  it("a tab click changes the status; the Unscheduled tab asks for the undated jobs", () => {
    render(<DealsPage />);
    fireEvent.click(screen.getByRole("tab", { name: /Canceled/ }));
    expect(lastPageParams()).toMatchObject({ superStatus: "canceled" });
    fireEvent.click(screen.getByRole("tab", { name: /Unscheduled/ }));
    expect(lastPageParams()).toMatchObject({ unscheduled: true });
    expect(lastPageParams()).not.toHaveProperty("superStatus");
  });

  it("Day ↓ flips the server direction; Hour ↓ reorders the loaded rows and leaves the server ascending", () => {
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
    const sort = screen.getByRole("combobox", { name: "Sort jobs" });
    fireEvent.change(sort, { target: { value: "day_desc" } });
    expect(lastPageParams()).toMatchObject({ dir: "desc" });
    fireEvent.change(sort, { target: { value: "hour_desc" } });
    expect(lastPageParams()).toMatchObject({ dir: "asc" });
    expect(screen.getAllByRole("row")[1].textContent).toContain("B22222");
  });

  it("the hour window and a job-code search travel as parameters", () => {
    render(<DealsPage />);
    fireEvent.change(screen.getByLabelText("From hour"), { target: { value: "08:00" } });
    fireEvent.change(screen.getByLabelText("To hour"), { target: { value: "12:00" } });
    expect(lastPageParams()).toMatchObject({ hourFrom: "08:00", hourTo: "12:00" });
    fireEvent.change(screen.getByPlaceholderText(/Search job/), { target: { value: "862n5b" } });
    expect(lastPageParams()).toMatchObject({ search: "862N5B" });
  });

  it("free text narrows the rows on screen without a server parameter", () => {
    render(<DealsPage />);
    // Five characters: not a job code, so it stays on the page.
    fireEvent.change(screen.getByPlaceholderText(/Search job/), { target: { value: "22222" } });
    expect(lastPageParams()).not.toHaveProperty("search");
    const rows = screen.getAllByRole("row").slice(1);
    expect(rows).toHaveLength(1);
    expect(rows[0].textContent).toContain("B22222");
  });
});

describe("DealsPage — tab counts and clients", () => {
  it("shows the server's numbers on the tabs and a dash where it would not count", () => {
    render(<DealsPage />);
    expect(screen.getByRole("tab", { name: /Submitted/ }).textContent).toContain("207");
    expect(screen.getByRole("tab", { name: /Unscheduled/ }).textContent).toContain("5");
    expect(screen.getByRole("tab", { name: /Canceled/ }).textContent).toContain("—");
    expect(mocks.countsParams[mocks.countsParams.length - 1]).toEqual({});
  });

  it("the counts follow the filters but not the tab", () => {
    render(<DealsPage />);
    fireEvent.change(screen.getByLabelText("From hour"), { target: { value: "09:00" } });
    fireEvent.click(screen.getByRole("tab", { name: /^Done(—|\d)/ }));
    expect(mocks.countsParams[mocks.countsParams.length - 1]).toEqual({ hourFrom: "09:00" });
  });

  it("says a number the server stopped counting is a floor", () => {
    // Сервер рахує закритий статус лише до стелі; «10 000» без знака
    // читалось би як підсумок.
    mocks.counts = { ...mocks.counts, done: 10_000, atLeast: ["done", "total"] } as never;
    render(<DealsPage />);

    expect(screen.getByRole("tab", { name: /^Done(?!\s*Pending)/ }).textContent).toContain("10,000+");
  });

  it("resolves only the contacts of the rows it holds", () => {
    useJobFieldsStore.setState({ visible: { ...DEFAULT_VISIBLE, phone: true } });
    render(<DealsPage />);
    expect(mocks.contactCalls[mocks.contactCalls.length - 1]).toEqual({
      ids: ["c1", "c2"],
      enabled: true,
    });
  });
});

describe("DealsPage — paging", () => {
  it("offers the next page when there is one, and asks for it on click", () => {
    mocks.hasNextPage = true;
    render(<DealsPage />);
    fireEvent.click(screen.getByRole("button", { name: "Next page" }));
    expect(mocks.fetchNextPage).toHaveBeenCalled();
  });

  it("numbers the page it holds and the one the cursor can still open", () => {
    mocks.hasNextPage = true;
    render(<DealsPage />);
    expect(screen.getByRole("button", { name: "Page 1" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("button", { name: "Page 2" })).toBeInTheDocument();
  });

  it("says nothing about more pages when the list is complete", () => {
    render(<DealsPage />);
    expect(screen.queryByRole("button", { name: "Next page" })).not.toBeInTheDocument();
  });

  it("counts the rows on screen against the number the server counted", () => {
    render(<DealsPage />);
    // 207 — це лічильник вкладки Submitted, тобто скільки всього робіт за фільтром.
    expect(screen.getByText("Showing 1–2 of 207")).toBeInTheDocument();
  });

  it("the chosen row count is what the server is asked for, and it is remembered", () => {
    const { unmount } = render(<DealsPage />);
    fireEvent.click(screen.getByRole("combobox", { name: /rows per page/i }));
    fireEvent.click(screen.getByRole("option", { name: "100" }));
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
 * Раніше сторінка тримала перший кадр, доки не приїде весь довідник
 * користувачів (564 записи заради кількох техніків) і доки не відповість
 * запит по контактах, який навіть не міг стартувати, поки не приїдуть роботи.
 * Тепер `GET /deals` віддає `included` — самі імена — тож таблиця малюється
 * без жодного з цих двох запитів.
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
    // Neither join has answered: the directory is loading and no contact is
    // in hand at all. The row must still read as a finished row.
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
        // The second page names its own technician; its client was named on
        // the first one, and only a lookup merged across both finds her.
        data: [{ ...deal, id: "d2", dealNumber: "B22222", assignedTechIds: ["t8"] }],
        pagination: { count: 1 },
        included: {
          technicians: [{ id: "t8", firstName: "Bob", lastName: "Poole" }],
          clients: [],
        },
      },
    ];
    render(<DealsPage />);

    fireEvent.click(screen.getByRole("button", { name: "Page 2" }));
    expect(screen.getAllByRole("row")[1].textContent).toContain("B22222");
    expect(screen.getByLabelText("Technician")).toHaveTextContent("Bob Poole");
    expect(screen.getByText("Jane Smith")).toBeInTheDocument();
  });

  it("asks the directory only about the roster behind the tech filter, never about the rows", () => {
    withNames();
    render(<DealsPage />);

    // `useAllTechnicians` offers t1; t9 is on a row and is named by `included`.
    expect(mocks.userMapIds[mocks.userMapIds.length - 1]).toEqual(["t1"]);
  });
});

describe("DealsPage — contacts only where contact data is shown", () => {
  it("asks for no contacts while the Phone and Email columns are off", () => {
    render(<DealsPage />);
    expect(mocks.contactCalls[mocks.contactCalls.length - 1]?.enabled).toBe(false);
  });

  it("asks for them the moment a column that shows contact data is on", () => {
    useJobFieldsStore.setState({ visible: { ...DEFAULT_VISIBLE, email: true } });
    render(<DealsPage />);
    expect(mocks.contactCalls[mocks.contactCalls.length - 1]?.enabled).toBe(true);
  });

  /**
   * Free text is matched against the client's name, email and number on the
   * page, so typing is the other moment the contacts are genuinely needed.
   */
  it("asks for them when free text narrows the rows on screen", () => {
    render(<DealsPage />);
    expect(mocks.contactCalls[mocks.contactCalls.length - 1]?.enabled).toBe(false);
    fireEvent.change(screen.getByPlaceholderText(/Search job/), { target: { value: "jane" } });
    expect(mocks.contactCalls[mocks.contactCalls.length - 1]?.enabled).toBe(true);
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
