import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { JobSuperStatus, type JobsReportColumnId, type JobsReportRow } from "@bitcrm/types";
import { JobsReportTable, JobsReportTableShell } from "./jobs-report-table";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const row = (over: Partial<JobsReportRow> = {}): JobsReportRow => ({
  id: "d1",
  jobNumber: "QFBQOD",
  contactId: "c1",
  client: "Deena Galange",
  tags: [
    { id: "t1", name: "Needs a call", color: "blue" },
    { id: "t2", name: "VIP", color: "red" },
  ],
  jobTypeId: "jt1",
  type: "New Car key",
  createdAt: "2026-10-08T20:26:00.000Z",
  scheduled: "2026-10-08T13:30",
  end: "2026-10-08T14:30",
  phone: "+16024783345",
  superStatus: JobSuperStatus.CANCELED,
  status: "Canceled",
  subStatusId: "ss1",
  subStatus: "Cant Do - tech said cant do",
  techIds: ["u1", "u2"],
  tech: ["(3) AZ - Dan Orly Sub", "Sam Tech"],
  createdById: "u9",
  createdBy: "(1) (Daniel) 31 Dispatcher",
  city: "Mesa",
  state: "Arizona",
  zip: "85203",
  serviceAreaId: "sa1",
  serviceArea: "SURE LOCK AZ",
  total: 87.63,
  sourceId: "s1",
  source: "SLS AZ GOOGLE ADS",
  origin: "new",
  ...over,
});

const COLUMNS: JobsReportColumnId[] = ["jobNumber", "client", "tags", "type", "created", "status", "tech", "serviceArea", "total", "source"];

function setup(rows: JobsReportRow[], over: Partial<Parameters<typeof JobsReportTable>[0]> = {}) {
  const addFilter = vi.fn();
  const onSort = vi.fn();
  render(<JobsReportTable rows={rows} columns={COLUMNS} sort="created" dir="desc" onSort={onSort} addFilter={addFilter} {...over} />);
  return { addFilter, onSort };
}

const bodyRows = () => within(screen.getByRole("table")).getAllByRole("row").slice(1);
const fillers = () => [...document.querySelectorAll("tbody tr[aria-hidden]")];

describe("JobsReportTable — Workiz's grid (rep_jobs_wz_01_default, _21_one_row, _11_empty_search)", () => {
  it("never runs shorter than ten rows: one job, nine blank striped rows", () => {
    setup([row()]);
    expect(fillers()).toHaveLength(9);
    expect(bodyRows()).toHaveLength(1);
  });

  it("pads nothing once ten rows are there", () => {
    setup(Array.from({ length: 12 }, (_, i) => row({ id: `d${i}`, jobNumber: `J${i}` })));
    expect(fillers()).toHaveLength(0);
  });

  it("says 'No Records Found' over ten blank rows when nothing matches", () => {
    setup([]);
    expect(screen.getByText("No Records Found")).toBeInTheDocument();
    expect(fillers()).toHaveLength(10);
  });

  it("links the job number to the job and the client's name to the client", () => {
    setup([row()]);
    expect(screen.getByRole("link", { name: "QFBQOD" })).toHaveAttribute("href", "/deals/d1");
    expect(screen.getByRole("link", { name: "Deena Galange" })).toHaveAttribute("href", "/contacts/c1");
    // Under the name: the number, as a call link.
    expect(screen.getByRole("link", { name: "(602) 478-3345" })).toHaveAttribute("href", "tel:+16024783345");
  });

  it("puts the email under the name when there is no number", () => {
    setup([row({ phone: undefined, email: "dan@fearngroup.com" })]);
    const client = bodyRows()[0].querySelectorAll("td")[1];
    expect(client).toHaveTextContent("dan@fearngroup.com");
  });

  it("filters by a value clicked in Type, Status, Tech, Tags, Metro Area and Source, as Workiz does", async () => {
    const { addFilter } = setup([row()]);
    const r = bodyRows()[0];
    await userEvent.click(within(r).getByRole("button", { name: "New Car key" }));
    await userEvent.click(within(r).getByRole("button", { name: "Canceled" }));
    await userEvent.click(within(r).getByRole("button", { name: "Sam Tech" }));
    await userEvent.click(within(r).getByRole("button", { name: "VIP" }));
    await userEvent.click(within(r).getByRole("button", { name: "SURE LOCK AZ" }));
    await userEvent.click(within(r).getByRole("button", { name: "SLS AZ GOOGLE ADS" }));
    expect(addFilter.mock.calls).toEqual([
      ["jobTypeId", "jt1"],
      ["status", "canceled"],
      ["techId", "u2"],
      ["tagId", "t2"],
      ["serviceAreaId", "sa1"],
      ["sourceId", "s1"],
    ]);
  });

  it("prints the sub-status small under the status, and the total as Workiz does", () => {
    setup([row()]);
    const r = bodyRows()[0];
    expect(within(r).getByText("Cant Do - tech said cant do")).toBeInTheDocument();
    expect(r).toHaveTextContent("$87.63");
    expect(r).toHaveTextContent("Thu Oct 08, 2026 04:26 pm");
  });

  it("words the status as Workiz does", () => {
    setup([row({ superStatus: JobSuperStatus.IN_PROGRESS, status: "In Progress", subStatus: undefined, subStatusId: undefined })]);
    expect(within(bodyRows()[0]).getByRole("button", { name: "In progress" })).toBeInTheDocument();
  });

  it("marks the sorted column and asks for another sort from a header", async () => {
    const { onSort } = setup([row()]);
    expect(screen.getByRole("columnheader", { name: "Job Created" })).toHaveAttribute("aria-sort", "descending");
    await userEvent.click(screen.getByRole("button", { name: "Sort by Total" }));
    expect(onSort).toHaveBeenLastCalledWith("total");
  });
});

describe("JobsReportTableShell — the loading grid", () => {
  it("is the header and ten blank rows, with a loader", () => {
    render(<JobsReportTableShell columns={COLUMNS} />);
    expect(screen.getByRole("status", { name: "Loading jobs" })).toBeInTheDocument();
    expect(screen.getAllByRole("columnheader").map((h) => h.textContent)).toEqual([
      "Job #", "Client", "Tags", "Type", "Job Created", "Status", "Tech", "Metro Area", "Total", "Source",
    ]);
    expect(fillers()).toHaveLength(10);
  });
});
