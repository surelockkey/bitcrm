import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ClientType, CrmStatus } from "@bitcrm/types";
import type { Company } from "@bitcrm/types";
import type { WzRowOpenEvent } from "@/components/workiz/report-grid";
import { DEFAULT_COMPANY_FIELDS, type CompanyFieldId } from "../companies-list";
import { CompaniesTable } from "./companies-table";

function company(over: Partial<Company> = {}): Company {
  return {
    id: "co1",
    title: "Acme Storage",
    phones: ["+14045551234"],
    emails: [],
    website: "acme.example",
    address: "1 Main St, Phoenix, AZ 85001",
    clientType: ClientType.COMMERCIAL,
    status: CrmStatus.ACTIVE,
    createdBy: "u1",
    createdAt: "2026-10-08T20:26:00.000Z",
    updatedAt: "",
    ...over,
  };
}

function renderTable({
  companies = [company()],
  columns = DEFAULT_COMPANY_FIELDS,
  onOpen = vi.fn<(company: Company, e: WzRowOpenEvent) => void>(),
  onSort = vi.fn<(column: CompanyFieldId) => void>(),
}: {
  companies?: Company[];
  columns?: readonly CompanyFieldId[];
  onOpen?: (company: Company, e: WzRowOpenEvent) => void;
  onSort?: (column: CompanyFieldId) => void;
} = {}) {
  const utils = render(
    <CompaniesTable companies={companies} columns={columns} sort={{ id: "created", dir: "desc" }} onSort={onSort} onOpen={onOpen} zone="America/Los_Angeles" />,
  );
  return { ...utils, onOpen, onSort };
}

describe("CompaniesTable — the Workiz Clients grid for companies", () => {
  it("draws the saved columns in their order", () => {
    renderTable({ columns: ["phone", "name", "website"] });
    const heads = screen.getAllByRole("columnheader").map((th) => th.getAttribute("aria-label"));
    expect(heads).toEqual(["Phone", "Name", "Website"]);
  });

  it("puts the email under the name, as Workiz's Name cell does", () => {
    renderTable({ companies: [company({ emails: ["office@acme.example"] })] });
    const row = screen.getByText("Acme Storage").closest("tr")!;
    expect(within(row).getByText("office@acme.example")).toBeInTheDocument();
  });

  it("puts the number under the name as a blue tel link when there is no email", () => {
    renderTable({ columns: ["name"] });
    const link = screen.getByRole("link", { name: "(404) 555-1234" });
    expect(link).toHaveAttribute("href", "tel:+14045551234");
  });

  it("shows a platinum account's PLATINUM chip under its name", () => {
    renderTable({ companies: [company({ isPlatinum: true })], columns: ["name"] });
    expect(screen.getByText("Platinum")).toBeInTheDocument();
  });

  it("prints the type as words, the phone as a tel link, Created on the account's clock", () => {
    renderTable();
    expect(screen.getByText("Commercial")).toBeInTheDocument();
    // Under the name (no email) and in the Phone column, as Workiz prints it twice.
    const links = screen.getAllByRole("link", { name: "(404) 555-1234" });
    expect(links).toHaveLength(2);
    for (const a of links) expect(a).toHaveAttribute("href", "tel:+14045551234");
    expect(screen.getByText("Thu Oct 08, 2026 01:26 PM")).toBeInTheDocument();
    expect(screen.getByText("1 Main St, Phoenix, AZ 85001")).toBeInTheDocument();
  });

  it("says a withheld number is hidden, and a missing one is missing", () => {
    renderTable({
      companies: [company({ id: "a", phones: [], phonesMasked: true, phoneCount: 1 }), company({ id: "b", title: "Bare", phones: [] })],
      columns: ["phone"],
    });
    expect(screen.getByText("Number hidden")).toBeInTheDocument();
    expect(screen.getByText("No phone number")).toBeInTheDocument();
  });

  it("opens the company from anywhere on its row", async () => {
    const { onOpen } = renderTable();
    await userEvent.click(screen.getByText("Commercial"));
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: "co1" }), expect.anything());
  });

  it("sorts by the Name, Phone and Created headers — not by Address", async () => {
    const { onSort } = renderTable();
    await userEvent.click(screen.getByRole("button", { name: "Sort by Name" }));
    expect(onSort).toHaveBeenCalledWith("name");
    expect(screen.queryByRole("button", { name: "Sort by Address" })).toBeNull();
    expect(screen.getByRole("columnheader", { name: "Created" })).toHaveAttribute("aria-sort", "descending");
  });

  it("says No Records Found over the blank rows when nothing matches", () => {
    renderTable({ companies: [] });
    expect(screen.getByText("No Records Found")).toBeInTheDocument();
  });
});

/** Стабільний перший кадр: оголошені ширини, які можна тягнути. */
describe("CompaniesTable — a stable first frame", () => {
  it("lays the columns out at declared widths, not by content", () => {
    const { container } = renderTable();
    expect(container.querySelector("table")?.className).toContain("table-fixed");
  });

  it("declares a width for every column", () => {
    const { container } = renderTable();
    const cols = [...container.querySelectorAll("colgroup col")];
    expect(cols).toHaveLength(container.querySelectorAll("thead th").length);
    for (const col of cols) expect((col as HTMLElement).style.width).not.toBe("");
  });

  it("lets no body cell set a width of its own", () => {
    const { container } = renderTable();
    for (const td of [...container.querySelectorAll("tbody td")]) {
      for (const cls of td.className.split(/\s+/)) {
        expect(cls).not.toMatch(/^(min-w-|max-w-|w-)/);
      }
      expect((td as HTMLElement).style.width).toBe("");
    }
  });

  it("puts a resize handle on every header", () => {
    renderTable();
    for (const id of DEFAULT_COMPANY_FIELDS) {
      expect(screen.getByTestId(`resize-${id}`)).toBeInTheDocument();
    }
  });
});
