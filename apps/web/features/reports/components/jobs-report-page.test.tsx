import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { JobSuperStatus, type JobsReportPage, type JobsReportRow } from "@bitcrm/types";
import { JobsReportPage as Page } from "./jobs-report-page";

const perms = vi.hoisted(() => ({ granted: new Set<string>() }));
vi.mock("@/features/auth/use-permissions", () => ({
  useDenied: () => (resource: string, action = "view") => !perms.granted.has(`${resource}.${action}`),
  usePermissions: () => ({
    can: (resource: string, action = "view") => perms.granted.has(`${resource}.${action}`),
    isLoading: false,
  }),
}));

const hooks = vi.hoisted(() => ({
  useJobsReport: vi.fn(),
  settings: { columns: [] as string[], by: "end" },
  save: vi.fn(),
}));
vi.mock("../jobs/hooks", () => ({
  useJobsReport: hooks.useJobsReport,
  useJobsReportSettings: () => ({ data: hooks.settings, isFetched: true }),
  useSaveJobsReportSettings: () => ({ mutate: hooks.save, isPending: false }),
}));
const download = vi.hoisted(() => vi.fn());
vi.mock("../jobs/api", () => ({ downloadJobsReportCsv: download }));

vi.mock("@/features/deals/hooks", () => ({
  useUserMap: () => ({
    map: new Map(),
    users: [
      { id: "u-tech", firstName: "Sam", lastName: "Tech" },
      { id: "u-disp", firstName: "Tess", lastName: "Disp" },
    ],
    isLoading: false,
  }),
}));
vi.mock("@/features/technicians/hooks", () => ({ useAllTechnicians: () => ({ profiles: [{ userId: "u-tech" }], isLoading: false }) }));
vi.mock("@/features/job-types/hooks", () => ({ useJobTypes: () => ({ data: [{ id: "jt1", name: "Car key" }] }) }));
vi.mock("@/features/job-sources/hooks", () => ({ useJobSources: () => ({ data: [{ id: "s1", name: "GMB" }] }) }));
vi.mock("@/features/job-statuses/hooks", () => ({ useJobStatuses: () => ({ data: [{ id: "ss1", name: "Paid", group: "done" }] }) }));
vi.mock("@/features/job-tags/hooks", () => ({ useJobTags: () => ({ data: [{ id: "t1", name: "VIP", color: "red" }] }) }));
vi.mock("@/features/service-areas/hooks", () => ({ useServiceAreas: () => ({ data: [{ id: "sa1", name: "SURE LOCK CT" }] }) }));
vi.mock("@/features/external-companies/hooks", () => ({ useExternalCompanies: () => ({ data: [] }) }));

const row = (over: Partial<JobsReportRow> = {}): JobsReportRow => ({
  id: "d1",
  jobNumber: "C0TCAE",
  contactId: "c1",
  client: "Kayleigh Brown",
  tags: [{ id: "t1", name: "VIP", color: "red" }],
  jobTypeId: "jt1",
  type: "Car key",
  createdAt: "2026-09-29T18:35:00.000Z",
  scheduled: "2026-09-29T15:00",
  end: "2026-09-29T16:00",
  phone: "+15805551234",
  superStatus: JobSuperStatus.DONE,
  status: "Done",
  subStatusId: "ss1",
  subStatus: "Paid",
  techIds: ["u-tech"],
  tech: ["Sam Tech"],
  createdById: "u-disp",
  createdBy: "Tess Disp",
  city: "Madill",
  state: "Oklahoma",
  zip: "73446",
  serviceAreaId: "sa1",
  serviceArea: "SURE LOCK CT",
  total: 697.95,
  sourceId: "s1",
  source: "GMB",
  origin: "new",
  ...over,
});

const pageOf = (rows: JobsReportRow[], over: Partial<JobsReportPage> = {}): JobsReportPage => ({
  rows,
  pagination: { page: 1, pageSize: 50, total: rows.length, pages: 1, from: rows.length ? 1 : 0, to: rows.length },
  window: { by: "end", from: "2026-09-28", to: "2026-09-29" },
  sort: { column: "created", dir: "desc" },
  money: true,
  ...over,
});

const lastParams = () => Object.fromEntries(new URLSearchParams(hooks.useJobsReport.mock.lastCall![0] as string));

beforeEach(() => {
  perms.granted = new Set(["reports.view", "reports.edit", "financials.view"]);
  hooks.settings = {
    columns: ["jobNumber", "client", "tags", "type", "created", "scheduled", "end", "phone", "status", "tech", "city", "state", "zip", "serviceArea", "total", "source"],
    by: "end",
  };
  hooks.useJobsReport.mockReset();
  hooks.useJobsReport.mockImplementation(() => ({ data: pageOf([row(), row({ id: "d2", jobNumber: "UCKO12", total: 0 })]), isFetching: false }));
  hooks.save.mockReset();
  download.mockReset();
  try {
    localStorage.clear();
  } catch {
    /* jsdom */
  }
});

describe("JobsReportPage", () => {
  it("opens as Workiz does: this week Monday to today, by the account's date, newest created first, 50 rows", () => {
    render(<Page today="2026-09-29" />);
    expect(lastParams()).toEqual({
      by: "end",
      from: "2026-09-28",
      to: "2026-09-29",
      sort: "created",
      dir: "desc",
      page: "1",
      pageSize: "50",
    });
    expect(screen.getByRole("combobox", { name: "By" })).toHaveValue("end");
  });

  it("shows the account's columns in Workiz's order, and the Workiz result line", () => {
    render(<Page today="2026-09-29" />);
    const headers = within(screen.getByRole("table")).getAllByRole("columnheader").map((h) => h.getAttribute("aria-label"));
    expect(headers).toEqual([
      "Job #", "Client", "Tags", "Type", "Job Created", "Scheduled", "End", "Phone", "Status", "Tech",
      "City", "State", "Zip code", "Metro Area", "Total", "Source",
    ]);
    const first = within(screen.getByRole("table")).getAllByRole("row")[1];
    expect(first).toHaveTextContent("C0TCAE");
    expect(first).toHaveTextContent("Tue Sep 29, 2026 02:35 pm");
    expect(first).toHaveTextContent("(580) 555-1234");
    expect(first).toHaveTextContent("$697.95");
    expect(first).toHaveTextContent("Paid");
    expect(screen.getByText("Showing 1 to 2 of 2 results")).toBeInTheDocument();
  });

  it("asks again on another By, preset, page size and sort", async () => {
    render(<Page today="2026-09-29" />);
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "By" }), "created");
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Date preset" }), "this_year");
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Rows per page" }), "1000");
    await userEvent.click(screen.getByRole("button", { name: "Sort by Total" }));
    expect(lastParams()).toMatchObject({ by: "created", from: "2026-01-01", to: "2026-09-29", pageSize: "1000", sort: "total", dir: "asc" });
    expect(localStorage.getItem("bitcrm.jobs-report.by")).toBe("created");
  });

  it("filters by a value clicked in a cell, as Workiz does", async () => {
    render(<Page today="2026-09-29" />);
    const first = within(screen.getByRole("table")).getAllByRole("row")[1];
    await userEvent.click(within(first).getByRole("button", { name: "Car key" }));
    await userEvent.click(within(first).getByRole("button", { name: "Paid" }));
    expect(lastParams()).toMatchObject({ jobTypeId: "jt1", status: "done:ss1" });
    // The picked values show in the filter box and can be removed there.
    await userEvent.click(screen.getByRole("button", { name: "Remove Job type: Car key" }));
    expect(lastParams().jobTypeId).toBeUndefined();
  });

  it("offers Workiz's filter groups, OR inside a group", async () => {
    render(<Page today="2026-09-29" />);
    await userEvent.click(screen.getByRole("button", { name: "Filter results" }));
    const groups = screen.getByRole("group", { name: "Filter groups" });
    expect(within(groups).getAllByRole("region").map((g) => g.getAttribute("aria-label"))).toEqual([
      "Status", "Team", "Created by", "Tags", "Job type", "Job origin", "Source", "Service areas", "Companies",
    ]);
    const status = within(groups).getByRole("region", { name: "Status" });
    await userEvent.click(within(status).getByRole("checkbox", { name: "Done - Paid" }));
    await userEvent.click(within(status).getByRole("checkbox", { name: "Canceled" }));
    // Team lists the field team only.
    expect(within(within(groups).getByRole("region", { name: "Team" })).getAllByRole("checkbox").map((c) => c.textContent)).toEqual(["Sam Tech"]);
    expect(lastParams().status).toBe("done:ss1,canceled");
  });

  it("exports the same query with the visible columns", async () => {
    download.mockResolvedValue(new Blob(["Job #\r\n"]));
    render(<Page today="2026-09-29" />);
    await userEvent.click(screen.getByRole("button", { name: /Export/ }));
    const params = Object.fromEntries(new URLSearchParams(download.mock.lastCall![0] as string));
    expect(params).toMatchObject({ by: "end", from: "2026-09-28", to: "2026-09-29", sort: "created" });
    expect(params.columns?.split(",")).toHaveLength(16);
    expect(params.page).toBeUndefined();
  });

  it("saves the visible fields for the account", async () => {
    render(<Page today="2026-09-29" />);
    await userEvent.click(screen.getByRole("button", { name: /Fields/ }));
    const panel = screen.getByRole("dialog", { name: "Visible fields" });
    await userEvent.click(within(panel).getByLabelText("Email"));
    await userEvent.click(within(panel).getByLabelText("Tags"));
    await userEvent.click(within(panel).getByRole("button", { name: "Save fields" }));
    const saved = hooks.save.mock.lastCall![0].columns as string[];
    expect(saved).toContain("email");
    expect(saved).not.toContain("tags");
    expect(saved.indexOf("email")).toBe(saved.indexOf("phone") + 1);
  });

  it("hides Total without financials.view", () => {
    perms.granted.delete("financials.view");
    hooks.useJobsReport.mockImplementation(() => ({ data: pageOf([row({ total: undefined })], { money: false }), isFetching: false }));
    render(<Page today="2026-09-29" />);
    expect(screen.queryByRole("columnheader", { name: "Total" })).toBeNull();
  });

  it("is closed to anyone without the reports permission", () => {
    perms.granted = new Set(["deals.view"]);
    render(<Page today="2026-09-29" />);
    expect(screen.getByText(/no access/i)).toBeInTheDocument();
  });
});
