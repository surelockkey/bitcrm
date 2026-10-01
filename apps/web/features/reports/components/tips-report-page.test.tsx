import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { TipsReportJobsPage, TipsReportPage, TipsReportRow } from "@bitcrm/types";
import { TipsReportPage as Page } from "./tips-report-page";

const perms = vi.hoisted(() => ({ granted: new Set<string>() }));
vi.mock("@/features/auth/use-permissions", () => ({
  useDenied: () => (resource: string, action = "view") => !perms.granted.has(`${resource}.${action}`),
  usePermissions: () => ({
    can: (resource: string, action = "view") => perms.granted.has(`${resource}.${action}`),
    isLoading: false,
  }),
}));

const hooks = vi.hoisted(() => ({ useTipsReport: vi.fn(), useTipsReportJobs: vi.fn() }));
vi.mock("../tips/hooks", () => ({ useTipsReport: hooks.useTipsReport, useTipsReportJobs: hooks.useTipsReportJobs }));

vi.mock("@/features/deals/hooks", () => ({
  useUserMap: () => ({
    map: new Map(),
    users: [
      { id: "yakov", firstName: "YAKOV", lastName: "SZENDER", createdAt: "2017-04-18T19:17:00.000Z" },
      { id: "eli", firstName: "Eli", lastName: "Szender", createdAt: "2019-08-06T22:59:00.000Z" },
      { id: "yeter", firstName: "Yeter", lastName: "Mizrahi", createdAt: "2024-09-26T16:50:00.000Z" },
      { id: "disp", firstName: "Tess", lastName: "Disp", createdAt: "2020-01-01T00:00:00.000Z" },
    ],
    isLoading: false,
  }),
}));
vi.mock("@/features/technicians/hooks", () => ({
  useAllTechnicians: () => ({ profiles: [{ userId: "yakov" }, { userId: "eli" }, { userId: "yeter" }], isLoading: false }),
}));
vi.mock("@/features/job-types/hooks", () => ({ useJobTypes: () => ({ data: [{ id: "jt1", name: "New Car key" }] }) }));
const search = vi.hoisted(() => ({ useContactSearch: vi.fn() }));
vi.mock("@/features/clients/hooks", () => ({ useContactSearch: search.useContactSearch }));

const line = (techId: string, name: string, tips: number | null, jobs: number): TipsReportRow => ({ techId, name, tips, jobs });

// Workiz 01–27.09, as the server answers (its own order — the page decides).
const report = (over: Partial<TipsReportPage> = {}): TipsReportPage => ({
  rows: [line("yeter", "Yeter Mizrahi", 213.08, 195), line("yakov", "YAKOV SZENDER", 0, 6), line("eli", "Eli Szender", 881.55, 74)],
  window: { from: "2026-09-30", to: "2026-09-30" },
  money: true,
  ...over,
});

const jobsOf = (over: Partial<TipsReportJobsPage> = {}): TipsReportJobsPage => ({
  techId: "eli",
  rows: [
    {
      dealId: "d1",
      jobNumber: "JL3D1I",
      contactId: "c1",
      client: "Carin Carnevale",
      date: "2025-07-11T15:00",
      jobTypeId: "jt1",
      jobType: "Car Key Copy",
      total: 641.63,
      tip: 32.31,
      people: 2,
    },
  ],
  pagination: { page: 1, pageSize: 10, total: 1, pages: 1, from: 1, to: 1 },
  sort: { column: "default", dir: "asc" },
  money: true,
  ...over,
});

const lastParams = () => Object.fromEntries(new URLSearchParams(hooks.useTipsReport.mock.lastCall![0] as string));
const bodyRows = () => within(screen.getByRole("table")).getAllByRole("row").slice(1);

beforeEach(() => {
  perms.granted = new Set(["reports.view", "financials.view", "technicians.view"]);
  hooks.useTipsReport.mockReset();
  hooks.useTipsReport.mockImplementation(() => ({ data: report(), isFetching: false }));
  hooks.useTipsReportJobs.mockReset();
  hooks.useTipsReportJobs.mockImplementation(() => ({ data: jobsOf(), isFetching: false }));
  search.useContactSearch.mockReset();
  search.useContactSearch.mockImplementation((q: string) => ({
    data: q.length >= 2 ? [{ id: "c9", firstName: "CBRE Facilities", lastName: "Management" }] : [],
    isLoading: false,
    tooShort: q.length < 2,
  }));
});

describe("TipsReportPage", () => {
  it("opens as Workiz does: Today, by the job date, people in the order their accounts were made", () => {
    render(<Page today="2026-09-30" />);
    expect(lastParams()).toEqual({ from: "2026-09-30", to: "2026-09-30" });
    expect(screen.getByRole("combobox", { name: "Date preset" })).toHaveValue("today");
    expect(within(screen.getByRole("table")).getAllByRole("columnheader").map((h) => h.textContent)).toEqual(["Tech", "Tip total", "Jobs"]);
    expect(bodyRows().map((r) => r.textContent)).toEqual(["YAKOV SZENDER$0.006", "Eli Szender$881.5574", "Yeter Mizrahi$213.08195"]);
    expect(screen.getByText("Showing 1 to 3 of 3 results")).toBeInTheDocument();
    // No "By:" — the Tips report is always on the job date.
    expect(screen.queryByRole("combobox", { name: "By" })).not.toBeInTheDocument();
  });

  it("asks again for another period; sorts, searches and pages the lines itself", async () => {
    render(<Page today="2026-09-30" />);
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Date preset" }), "last_month");
    expect(lastParams()).toEqual({ from: "2026-08-01", to: "2026-08-31" });
    const calls = hooks.useTipsReport.mock.calls.length;

    await userEvent.click(screen.getByRole("button", { name: "Sort by Tip total" }));
    expect(bodyRows().map((r) => r.textContent?.split("$")[0])).toEqual(["YAKOV SZENDER", "Yeter Mizrahi", "Eli Szender"]);
    await userEvent.click(screen.getByRole("button", { name: /Sort by Tip total/ }));
    expect(bodyRows().map((r) => r.textContent?.split("$")[0])).toEqual(["Eli Szender", "Yeter Mizrahi", "YAKOV SZENDER"]);

    await userEvent.type(screen.getByRole("textbox", { name: "Search" }), "szender");
    expect(bodyRows()).toHaveLength(2);

    await userEvent.clear(screen.getByRole("textbox", { name: "Search" }));
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Rows per page" }), "5");
    expect(screen.getByRole("combobox", { name: "Rows per page" })).toHaveValue("5");
    // Sorting, searching and paging never ask the server again.
    expect(new Set(hooks.useTipsReport.mock.calls.slice(calls).map((c) => c[0]))).toEqual(new Set(["from=2026-08-01&to=2026-08-31"]));
  });

  it("opens a person's jobs right under their line: Workiz's seven columns, their share of the tip", async () => {
    render(<Page today="2026-09-30" />);
    await userEvent.click(screen.getByRole("button", { name: "Open the jobs of Eli Szender" }));
    expect(new URLSearchParams(hooks.useTipsReportJobs.mock.lastCall![0] as string).get("tech")).toBe("eli");
    const jobs = screen.getByRole("table", { name: "Jobs of Eli Szender" });
    expect(within(jobs).getAllByRole("columnheader").map((h) => h.textContent)).toEqual([
      "Job ID", "Job name", "Client", "Date", "Job type", "Total amount", "Tip",
    ]);
    const first = within(jobs).getAllByRole("row")[1];
    expect(first).toHaveTextContent("#JL3D1I");
    expect(first).toHaveTextContent("Fri Jul 11, 2025 03:00 pm");
    expect(first).toHaveTextContent("$641.63");
    expect(first).toHaveTextContent("$32.31");
    expect(within(jobs).getByRole("link", { name: "Carin Carnevale" })).toHaveAttribute("href", "/contacts/c1");

    await userEvent.click(within(jobs).getByRole("button", { name: "Sort by Tip" }));
    expect(Object.fromEntries(new URLSearchParams(hooks.useTipsReportJobs.mock.lastCall![0] as string))).toMatchObject({ tech: "eli", sort: "tip", dir: "asc" });
  });

  it("offers Workiz's three groups: Tech (the field team), Job type, Client (looked up as you type)", async () => {
    render(<Page today="2026-09-30" />);
    await userEvent.click(screen.getByRole("button", { name: "Filter results" }));
    const groups = screen.getByRole("group", { name: "Filter groups" });
    expect(within(groups).getAllByRole("region").map((g) => g.getAttribute("aria-label"))).toEqual(["Tech", "Job type", "Client"]);
    expect(within(within(groups).getByRole("region", { name: "Tech" })).getAllByRole("checkbox").map((c) => c.textContent)).toEqual([
      "Eli Szender",
      "YAKOV SZENDER",
      "Yeter Mizrahi",
    ]);
    await userEvent.click(within(within(groups).getByRole("region", { name: "Tech" })).getByRole("checkbox", { name: "Eli Szender" }));
    expect(lastParams()).toMatchObject({ techId: "eli" });

    await userEvent.type(screen.getByRole("textbox", { name: "Search filters" }), "cbre");
    const client = await screen.findByRole("checkbox", { name: "CBRE Facilities Management" });
    await userEvent.click(client);
    expect(lastParams()).toMatchObject({ techId: "eli", contactId: "c9" });
  });

  it("exports every line in the order on screen", async () => {
    const created: Blob[] = [];
    const url = vi.fn((b: Blob) => (created.push(b), "blob:x"));
    Object.assign(URL, { createObjectURL: url, revokeObjectURL: vi.fn() });
    render(<Page today="2026-09-30" />);
    await userEvent.click(screen.getByRole("button", { name: /Export/ }));
    expect(await created[0].text()).toBe("Tech,Tip total,Jobs\nYAKOV SZENDER,0.00,6\nEli Szender,881.55,74\nYeter Mizrahi,213.08,195");
  });

  it("shows only Tech and Jobs without financials.view", () => {
    perms.granted.delete("financials.view");
    hooks.useTipsReport.mockImplementation(() => ({ data: report({ money: false, rows: [line("eli", "Eli Szender", null, 74)] }), isFetching: false }));
    render(<Page today="2026-09-30" />);
    expect(within(screen.getByRole("table")).getAllByRole("columnheader").map((h) => h.textContent)).toEqual(["Tech", "Jobs"]);
    expect(bodyRows()[0]).toHaveTextContent("Eli Szender74");
  });

  it("says no access without reports.view", () => {
    perms.granted = new Set();
    render(<Page today="2026-09-30" />);
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });
});
