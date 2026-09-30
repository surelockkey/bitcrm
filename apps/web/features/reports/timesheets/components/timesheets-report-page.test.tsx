import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { TimesheetEntriesPage, TimesheetReportPage, TimesheetReportRow } from "@bitcrm/types";
import { TooltipProvider } from "@/components/ui/tooltip";
import { TimesheetsReportPage as Page } from "./timesheets-report-page";

const perms = vi.hoisted(() => ({ granted: new Set<string>() }));
vi.mock("@/features/auth/use-permissions", () => ({
  useDenied: () => (resource: string, action = "view") => !perms.granted.has(`${resource}.${action}`),
  usePermissions: () => ({
    can: (resource: string, action = "view") => perms.granted.has(`${resource}.${action}`),
    isLoading: false,
  }),
}));

const hooks = vi.hoisted(() => ({
  useTimesheetReport: vi.fn(),
  useTimesheetEntries: vi.fn(),
  useEntryJobs: vi.fn(),
}));
vi.mock("../hooks", () => hooks);
const api = vi.hoisted(() => ({ fetchTimesheetReport: vi.fn() }));
vi.mock("../api", () => api);

vi.mock("@/features/deals/hooks", () => ({
  useUserMap: () => ({
    map: new Map(),
    users: [
      { id: "yeter", firstName: "Yeter", lastName: "Mizrahi" },
      { id: "chris", firstName: "Chris", lastName: "Ray" },
    ],
    isLoading: false,
  }),
}));

// The six people of Workiz's September 1–27, 2026 (checked live 2026-09-30).
const line = (over: Partial<TimesheetReportRow>): TimesheetReportRow => ({
  userId: "u",
  name: "Someone",
  clockedIn: false,
  minutes: 0,
  grossMinutes: 0,
  cost: 0,
  grossCost: 0,
  jobs: 0,
  entries: 1,
  ...over,
});
const september: TimesheetReportPage = {
  rows: [
    line({ userId: "sales", name: "Sales Platinum", clockedIn: true }),
    line({ userId: "bohdan", name: "Bohdan TECH", clockedIn: true, jobs: 1 }),
    line({ userId: "gabriel", name: "Gabriel Kurth", jobs: 1 }),
    line({ userId: "yeter", name: "Yeter Mizrahi", clockedIn: true, minutes: 8757, grossMinutes: 8757, jobs: 34, entries: 50 }),
    line({ userId: "chris", name: "Chris Ray", minutes: 9535, grossMinutes: 9535, cost: 6356.67, grossCost: 6356.67, entries: 18 }),
    line({ userId: "joshua", name: "Joshua Riedler", minutes: 1, grossMinutes: 1, jobs: 2, entries: 2 }),
  ],
  total: { minutes: 18293, grossMinutes: 18293, cost: 6356.67, grossCost: 6356.67, jobs: 38, entries: 73 },
  pagination: { page: 1, pageSize: 10, total: 6, pages: 1, from: 1, to: 6 },
  window: { from: "2026-09-01", to: "2026-09-27" },
  sort: { column: "name", dir: "desc" },
  money: true,
};

const entries: TimesheetEntriesPage = {
  userId: "sales",
  name: "Sales Platinum",
  clockedIn: true,
  rows: [
    { id: "o", userId: "sales", startedAt: "2026-09-04T17:23:00.000Z", open: true, minutes: 0, cost: 0, source: "web" },
    {
      id: "c",
      userId: "sales",
      startedAt: "2026-09-03T12:00:00.000Z",
      endedAt: "2026-09-03T14:30:00.000Z",
      open: false,
      minutes: 150,
      cost: 100,
      dealId: "d1",
      startLocation: { lat: 41.26, lng: -72.94 },
      notes: "Forgot to clock out",
      source: "mobile",
    },
  ],
  total: { minutes: 150, grossMinutes: 150, cost: 100, grossCost: 100 },
  window: { from: "2026-09-01", to: "2026-09-27" },
  money: true,
};

const lastParams = () => Object.fromEntries(new URLSearchParams(hooks.useTimesheetReport.mock.lastCall![0] as string));
const renderPage = () =>
  render(
    <TooltipProvider>
      <Page today="2026-09-30" />
    </TooltipProvider>,
  );

beforeEach(() => {
  perms.granted = new Set(["reports.view", "financials.view", "deals.view"]);
  hooks.useTimesheetReport.mockReset();
  hooks.useTimesheetReport.mockImplementation(() => ({ data: september, isFetching: false }));
  hooks.useTimesheetEntries.mockReset();
  hooks.useTimesheetEntries.mockImplementation(() => ({ data: entries }));
  hooks.useEntryJobs.mockReset();
  hooks.useEntryJobs.mockImplementation(() => ({ data: new Map([["d1", { number: "ONW3G7" }]]) }));
  api.fetchTimesheetReport.mockReset();
});

describe("TimesheetsReportPage", () => {
  it("opens as Workiz does: this week from Monday, User descending, ten to a page", () => {
    renderPage();
    expect(lastParams()).toEqual({ from: "2026-09-28", to: "2026-09-30", sort: "name", dir: "desc", page: "1", pageSize: "10" });
    expect(screen.getByRole("combobox", { name: "Date preset" })).toHaveValue("this_week_mon");
    expect(screen.getByRole("combobox", { name: "Rows per page" })).toHaveValue("10");
  });

  it("prints Workiz's columns, the Total line on top and the Clocked In tag", () => {
    renderPage();
    const table = screen.getByRole("table");
    expect(within(table).getAllByRole("columnheader").map((h) => h.textContent)).toEqual(["User", "Hours", "Cost", "Jobs"]);
    const rows = within(table).getAllByRole("row");
    expect(rows[1]).toHaveTextContent("Total:304:53$6356.6738");
    expect(within(table).getByRole("button", { name: "Open Chris Ray" }).closest("tr")).toHaveTextContent(
      "Chris RayClocked Out158:55$6356.670",
    );
    expect(within(table).getByRole("button", { name: "Open Yeter Mizrahi" })).toHaveTextContent("Clocked In");
    expect(screen.getByText("Showing 1 to 6 of 6 results")).toBeInTheDocument();
    expect(screen.getByText("Page 1 of 1")).toBeInTheDocument();
  });

  it("drops Cost without financials.view", () => {
    perms.granted.delete("financials.view");
    hooks.useTimesheetReport.mockImplementation(() => ({
      data: { ...september, money: false, rows: september.rows.map(({ cost: _c, grossCost: _g, ...r }) => r), total: { ...september.total, cost: undefined } },
      isFetching: false,
    }));
    renderPage();
    expect(within(screen.getByRole("table")).getAllByRole("columnheader").map((h) => h.textContent)).toEqual(["User", "Hours", "Jobs"]);
  });

  it("asks again for another preset, page size, sort, search and filter", async () => {
    renderPage();
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Date preset" }), "recent");
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Rows per page" }), "50");
    await userEvent.click(screen.getByRole("button", { name: "Hours" }));
    expect(lastParams()).toMatchObject({ from: "2026-09-01", to: "2026-09-30", pageSize: "50", sort: "hours", dir: "desc" });

    await userEvent.click(screen.getByRole("button", { name: "Filter results" }));
    const groups = screen.getByRole("group", { name: "Filter groups" });
    expect(within(groups).getAllByRole("region").map((g) => g.getAttribute("aria-label"))).toEqual(["Team", "Jobs"]);
    await userEvent.click(within(within(groups).getByRole("region", { name: "Jobs" })).getByRole("checkbox", { name: "Without Job" }));
    await userEvent.click(within(within(groups).getByRole("region", { name: "Team" })).getByRole("checkbox", { name: "Chris Ray" }));
    expect(lastParams()).toMatchObject({ job: "without_job", userId: "chris" });
  });

  it("opens a line into that person's entries, with Workiz's cells", async () => {
    renderPage();
    await userEvent.click(screen.getByRole("button", { name: "Open Sales Platinum" }));
    expect(hooks.useTimesheetEntries).toHaveBeenLastCalledWith("userId=sales&from=2026-09-28&to=2026-09-30", true);
    expect(screen.getByText("Clocked in (locked)")).toBeInTheDocument();
    expect(screen.getByText("Fri Sep 04 2026 01:23 pm")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "ONW3G7" })).toHaveAttribute("href", "/deals/d1");
    expect(screen.getByRole("link", { name: "Clock in location" })).toHaveAttribute(
      "href",
      "https://www.google.com/maps/search/?api=1&query=41.26,-72.94",
    );
    expect(screen.getByText("Forgot to clock out")).toBeInTheDocument();
    expect(screen.getByText("Showing 1 to 2 of 2 results")).toBeInTheDocument();
  });

  it("exports every line of the query, Gross columns included", async () => {
    const created: Blob[] = [];
    URL.createObjectURL = vi.fn((b: Blob) => {
      created.push(b);
      return "blob:x";
    }) as never;
    URL.revokeObjectURL = vi.fn();
    api.fetchTimesheetReport.mockResolvedValue(september);
    renderPage();
    await userEvent.click(screen.getByRole("button", { name: /Export/ }));
    const params = Object.fromEntries(new URLSearchParams(api.fetchTimesheetReport.mock.lastCall![0] as string));
    expect(params).toMatchObject({ from: "2026-09-28", to: "2026-09-30", page: "1", pageSize: "1000" });
    const text = await created[0].text();
    expect(text.split("\n").slice(0, 2)).toEqual(["User,Hours,Cost,Gross Hours,Gross Cost,Jobs", "Total:,304:53,$6356.67,304:53,$6356.67,38"]);
  });

  it("is closed to anyone without reports.view", () => {
    perms.granted.delete("reports.view");
    renderPage();
    expect(screen.getByText("No access")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });
});
