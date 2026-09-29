import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ClientType, CrmStatus } from "@bitcrm/types";
import type { Company } from "@bitcrm/types";
import { CompaniesTable } from "./companies-table";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

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
    createdAt: "",
    updatedAt: "",
    ...over,
  };
}

/** Стабільний перший кадр: оголошені ширини, які можна тягнути. */
describe("CompaniesTable — a stable first frame", () => {
  const render1 = () => render(<CompaniesTable companies={[company()]} />);

  it("lays the columns out at declared widths, not by content", () => {
    const { container } = render1();
    expect(container.querySelector("table")?.className).toContain("table-fixed");
  });

  it("declares a width for every column", () => {
    const { container } = render1();
    const cols = [...container.querySelectorAll("colgroup col")];
    expect(cols).toHaveLength(container.querySelectorAll("thead th").length);
    for (const col of cols) expect((col as HTMLElement).style.width).not.toBe("");
  });

  it("lets no body cell set a width of its own", () => {
    const { container } = render1();
    for (const td of [...container.querySelectorAll("tbody td")]) {
      for (const cls of td.className.split(/\s+/)) {
        expect(cls).not.toMatch(/^(min-w-|max-w-|w-)/);
      }
      expect((td as HTMLElement).style.width).toBe("");
    }
  });

  it("puts a resize handle on every header", () => {
    render1();
    for (const id of ["company", "type", "phone", "website", "location"]) {
      expect(screen.getByTestId(`resize-${id}`)).toBeInTheDocument();
    }
  });

  it("still renders the row it is laying out", () => {
    render1();
    expect(screen.getByText("Acme Storage")).toBeInTheDocument();
    expect(screen.getByText("(404) 555-1234")).toBeInTheDocument();
  });
});
