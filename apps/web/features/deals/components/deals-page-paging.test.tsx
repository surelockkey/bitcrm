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
  pages: [] as { data: unknown[]; pagination: { nextCursor?: string; count: number } }[],
  counts: {} as Record<string, number | null>,
  fetchNextPage: vi.fn(),
  hasNextPage: false,
  pageParams: [] as unknown[],
  countsParams: [] as unknown[],
  contactIds: [] as string[][],
}));

vi.mock("../hooks", () => ({
  useDealsPage: (params: unknown) => {
    mocks.pageParams.push(params);
    return {
      data: { pages: mocks.pages, pageParams: [] },
      isLoading: false,
      isError: false,
      isFetching: false,
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
  useUserMap: () => ({ map: new Map() }),
}));
vi.mock("@/features/clients/hooks", () => ({
  useContactsByIds: (ids: string[]) => {
    mocks.contactIds.push(ids);
    return { map: new Map(), isLoading: false };
  },
}));
vi.mock("@/features/technicians/hooks", () => ({
  useAllTechnicians: () => ({ profiles: [{ userId: "t1" }], isLoading: false }),
}));
vi.mock("@/features/service-areas/hooks", () => ({
  useServiceAreas: () => ({ data: [{ id: "a1", name: "Phoenix", active: true }] }),
}));
vi.mock("@/features/job-types/hooks", () => ({ useJobTypes: () => ({ data: [] }) }));
vi.mock("@/features/job-types/lib", () => ({ activeJobTypes: () => [], useJobTypeName: () => () => "Lockout" }));
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
  mocks.contactIds = [];
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

  it("resolves only the contacts of the rows it holds", () => {
    render(<DealsPage />);
    expect(mocks.contactIds[mocks.contactIds.length - 1]).toEqual(["c1", "c2"]);
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
