import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import {
  ClientType,
  ContactSource,
  ContactType,
  CrmStatus,
  DealPriority,
  DealStatus,
  JobSuperStatus,
} from "@bitcrm/types";
import type { Contact, Deal } from "@bitcrm/types";

const { mocks } = vi.hoisted(() => ({
  mocks: {
    deals: [] as unknown[],
    perms: true,
    loading: false,
    pageParams: [] as Record<string, unknown>[],
    countsParams: [] as Record<string, unknown>[],
  },
}));

function deal(over: Partial<Deal>): Deal {
  return {
    id: "d1",
    dealNumber: "AAAAAA",
    contactId: "c1",
    clientType: ClientType.RESIDENTIAL,
    serviceArea: "Phoenix",
    address: { street: "1 Main", city: "Phoenix", state: "AZ", zip: "85001" },
    jobTypeId: "jt-1",
    superStatus: JobSuperStatus.SUBMITTED,
    assignedDispatcherId: "u1",
    priority: DealPriority.NORMAL,
    assignedTechIds: [],
    tagIds: [],
    status: DealStatus.ACTIVE,
    createdBy: "u1",
    createdAt: "2026-08-18T10:00:00.000Z",
    updatedAt: "",
    ...over,
  };
}

const contact: Contact = {
  id: "c1",
  firstName: "Jane",
  lastName: "Smith",
  phones: ["+14045551234"],
  emails: ["jane@acme.com"],
  addresses: [],
  type: ContactType.RESIDENTIAL,
  source: ContactSource.PHONE_CALL,
  status: CrmStatus.ACTIVE,
  createdBy: "u1",
  createdAt: "",
  updatedAt: "",
};

vi.mock("@/features/auth/use-permissions", () => ({
  usePermissions: () => ({ can: () => mocks.perms }),
}));
vi.mock("@/features/deals/hooks", () => ({
  // The server pages the window; here every page holds `size` of the fixture.
  useDealsPage: (params: Record<string, unknown>) => {
    mocks.pageParams.push(params);
    const size = Number(params.limit ?? 50);
    const pages = [];
    for (let i = 0; i < mocks.deals.length; i += size) {
      pages.push({ data: mocks.deals.slice(i, i + size), pagination: { count: Math.min(size, mocks.deals.length - i) } });
    }
    return {
      data: mocks.loading ? undefined : { pages: pages.length ? pages : [{ data: [], pagination: { count: 0 } }], pageParams: [] },
      isLoading: mocks.loading,
      hasNextPage: false,
      isFetchingNextPage: false,
      fetchNextPage: vi.fn(),
    };
  },
  useDealCounts: (params: Record<string, unknown>) => {
    mocks.countsParams.push(params);
    return { data: { total: mocks.deals.length }, isLoading: false };
  },
  useUserMap: () => ({ map: new Map() }),
}));
vi.mock("@/features/job-types/lib", () => ({
  useJobTypeName: () => () => "Lockout",
  activeJobTypes: () => [],
}));
vi.mock("@/features/job-sources/hooks", () => ({ useJobSources: () => ({ data: [] }) }));
vi.mock("@/features/external-companies/lib", () => ({ useExternalCompanyName: () => () => "—" }));
vi.mock("@/features/job-sources/lib", () => ({
  activeJobSources: () => [],
  useJobSourceName: () => () => "—",
}));
vi.mock("@/features/job-types/hooks", () => ({ useJobTypes: () => ({ data: [] }) }));
vi.mock("@/features/job-statuses/hooks", () => ({ useJobStatuses: () => ({ data: [] }) }));
vi.mock("@/features/job-statuses/lib", () => ({
  activeJobStatuses: () => [],
  useJobStatusName: () => () => "—",
}));
vi.mock("@/features/job-tags/hooks", () => ({ useJobTags: () => ({ data: [] }) }));
vi.mock("@/features/job-tags/lib", () => ({ activeJobTags: () => [] }));
vi.mock("@/features/job-tags/components/job-tag-chips", () => ({ JobTagChips: () => null }));
vi.mock("@/features/clients/hooks", () => ({
  useCompanyMap: () => ({ map: new Map() }),
  useContactsByIds: () => ({ map: new Map(), isLoading: false }),
}));
vi.mock("@/features/service-areas/hooks", () => ({ useServiceAreas: () => ({ data: [] }) }));
vi.mock("@/features/deals/api", () => ({ fetchAllDeals: vi.fn().mockResolvedValue([]) }));
vi.mock("@/features/clients/api", () => ({ getContactsByIds: vi.fn().mockResolvedValue([]) }));
vi.mock("@/features/custom-fields/hooks", () => ({ useCustomFields: () => ({ data: [] }) }));

import { JobsReportPage } from "./jobs-report-page";

describe("JobsReportPage", () => {
  const lastParams = () => mocks.pageParams[mocks.pageParams.length - 1];
  beforeEach(() => {
    mocks.perms = true;
    mocks.loading = false;
    mocks.pageParams = [];
    mocks.countsParams = [];
    mocks.deals = [
      deal({ id: "a", dealNumber: "A11111" }),
      deal({ id: "b", dealNumber: "B22222", superStatus: JobSuperStatus.CANCELED }),
    ];
  });

  it("lists jobs with report columns", () => {
    render(<JobsReportPage />);

    expect(screen.getByText("A11111")).toBeInTheDocument();
    expect(screen.getByText("B22222")).toBeInTheDocument();
    for (const col of ["Job #", "Client", "Type", "Created", "Scheduled", "Status", "Total", "Source"]) {
      expect(screen.getByRole("columnheader", { name: col })).toBeInTheDocument();
    }
  });

  it("narrows by search — free text on the page, a job code through the server", () => {
    render(<JobsReportPage />);

    // Five characters: not a job code, so it narrows the page on screen.
    fireEvent.change(screen.getByPlaceholderText(/search/i), { target: { value: "22222" } });
    expect(lastParams()).not.toHaveProperty("search");
    expect(screen.queryByText("A11111")).not.toBeInTheDocument();
    expect(screen.getByText("B22222")).toBeInTheDocument();

    // Six: a job code, which the server looks up on its reservation.
    fireEvent.change(screen.getByPlaceholderText(/search/i), { target: { value: "b22222" } });
    expect(lastParams()).toMatchObject({ search: "B22222" });
  });

  it("pages from both the top and the bottom pager, a server page at a time", () => {
    mocks.deals = Array.from({ length: 12 }, (_, i) =>
      deal({ id: `d${i}`, dealNumber: `NUM${String(i).padStart(3, "0")}` }),
    );
    render(<JobsReportPage />);
    // Two pagers, both live.
    const nexts = screen.getAllByRole("button", { name: "Next page" });
    expect(nexts).toHaveLength(2);
    // Page size down to 10: the server is asked for pages of ten.
    fireEvent.change(screen.getAllByRole("combobox", { name: "Rows per page" })[0], {
      target: { value: "10" },
    });
    expect(lastParams()).toMatchObject({ limit: 10 });
    expect(screen.getByText("NUM000")).toBeInTheDocument();
    expect(screen.queryByText("NUM011")).not.toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: "Next page" })[1]);
    expect(screen.queryByText("NUM000")).not.toBeInTheDocument();
    expect(screen.getByText("NUM011")).toBeInTheDocument();
    // The total is the server's count, not the rows on screen.
    expect(screen.getAllByText(/11–12 of 12/).length).toBeGreaterThan(0);
  });

  it("the By: field picks the window the server reads, this week by default", () => {
    render(<JobsReportPage />);
    expect(lastParams()).toHaveProperty("createdFrom");
    expect(lastParams()).not.toHaveProperty("scheduledFrom");
    fireEvent.change(screen.getByRole("combobox", { name: "Date field" }), { target: { value: "closedAt" } });
    expect(lastParams()).toHaveProperty("closedFrom");
    expect(lastParams()).not.toHaveProperty("createdFrom");
    // The window is never open-ended: there is no "All time".
    expect(screen.queryByRole("option", { name: "All time" })).not.toBeInTheDocument();
  });

  it("sorts by day through the server and by hour on the page", () => {
    mocks.deals = [
      deal({ id: "a", dealNumber: "A11111", scheduledDate: "2026-08-20", scheduledTimeSlot: "14:00-15:00" }),
      deal({ id: "b", dealNumber: "B22222", scheduledDate: "2026-08-18", scheduledTimeSlot: "08:00-09:00" }),
    ];
    render(<JobsReportPage />);
    const firstDataRow = () => screen.getAllByRole("row")[1];
    // Default keeps the server's order (newest first).
    expect(firstDataRow().textContent).toContain("A11111");
    expect(lastParams()).toMatchObject({ dir: "desc" });
    fireEvent.change(screen.getByRole("combobox", { name: "Date field" }), {
      target: { value: "scheduledDate" },
    });
    fireEvent.change(screen.getByRole("combobox", { name: "Sort jobs" }), {
      target: { value: "day_asc" },
    });
    expect(lastParams()).toMatchObject({ sort: "schedule", dir: "asc" });
    fireEvent.change(screen.getByRole("combobox", { name: "Sort jobs" }), {
      target: { value: "hour_asc" },
    });
    expect(firstDataRow().textContent).toContain("B22222");
  });

  it("the hour window is a server parameter on the visit's slot", () => {
    render(<JobsReportPage />);
    fireEvent.change(screen.getByLabelText("From hour"), { target: { value: "12:00" } });
    expect(lastParams()).toMatchObject({ hourFrom: "12:00" });
    expect(mocks.countsParams[mocks.countsParams.length - 1]).toMatchObject({ hourFrom: "12:00" });
  });

  it("offers the date-field switch, presets and export", () => {
    render(<JobsReportPage />);

    expect(screen.getByRole("combobox", { name: "Date field" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Date preset" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /export/i })).toBeInTheDocument();
  });

  it("shows a loading skeleton on first render instead of an empty flash", () => {
    mocks.loading = true;
    render(<JobsReportPage />);

    expect(screen.getByRole("status", { name: /loading jobs/i })).toBeInTheDocument();
    expect(screen.queryByText(/no jobs match/i)).not.toBeInTheDocument();
  });

  it("blocks users without the reports permission", () => {
    mocks.perms = false;
    render(<JobsReportPage />);

    expect(screen.getByText(/no access/i)).toBeInTheDocument();
  });
});
