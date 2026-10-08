import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { WzDataTable } from "./data-table";

const COLUMNS = [
  { key: "name", label: "Job Source" },
  { key: "all", label: "All Jobs" },
];
const ROWS = [
  { key: "a", cells: ["A-1 TX GOOGLE ADS", "25"] },
  { key: "b", cells: ["SURE CT ORGANIC", "7"] },
];

describe("WzDataTable", () => {
  it("is a table named by its label, with a header, the rows and a Totals footer", () => {
    render(
      <WzDataTable
        aria-label="Sources"
        columns={COLUMNS}
        rows={ROWS}
        footer={["Totals:", "32"]}
        sort={{ key: "name", dir: "asc" }}
        onSort={() => {}}
      />,
    );
    const t = screen.getByRole("table", { name: "Sources" });
    const rows = within(t).getAllByRole("row");
    expect(rows).toHaveLength(4);
    expect(rows[1]).toHaveTextContent("A-1 TX GOOGLE ADS");
    expect(rows[3]).toHaveTextContent("Totals:32");
  });

  it("marks the sorted column as DataTables does — aria-sort, its cells shaded", () => {
    render(
      <WzDataTable
        aria-label="Sources"
        columns={COLUMNS}
        rows={ROWS}
        sort={{ key: "name", dir: "asc" }}
        onSort={() => {}}
      />,
    );
    expect(
      screen.getByRole("columnheader", { name: /Job Source/ }),
    ).toHaveAttribute("aria-sort", "ascending");
    expect(
      screen.getByRole("columnheader", { name: /All Jobs/ }),
    ).toHaveAttribute("aria-sort", "none");
    expect(screen.getByText("SURE CT ORGANIC").className).toContain(
      "bg-[#f1f1f1]",
    );
    expect(screen.getByText("7").className).not.toContain("bg-[#f1f1f1]");
  });

  it("sorts on a header click", async () => {
    const onSort = vi.fn();
    render(
      <WzDataTable
        aria-label="Sources"
        columns={COLUMNS}
        rows={ROWS}
        sort={null}
        onSort={onSort}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "All Jobs" }));
    expect(onSort).toHaveBeenCalledWith("all");
  });

  it("says No Records Found over an empty body, the footer still there", () => {
    render(
      <WzDataTable
        aria-label="Sources"
        columns={COLUMNS}
        rows={[]}
        footer={["Totals:", "0"]}
        sort={null}
        onSort={() => {}}
      />,
    );
    expect(screen.getByText("No Records Found")).toBeInTheDocument();
    expect(screen.getByText("Totals:")).toBeInTheDocument();
  });

  it("puts DataTables' search box over the table when asked", async () => {
    const onSearch = vi.fn();
    render(
      <WzDataTable
        aria-label="Area"
        columns={COLUMNS}
        rows={ROWS}
        sort={null}
        onSort={() => {}}
        search={{ value: "", onChange: onSearch }}
      />,
    );
    const box = screen.getByRole("searchbox", { name: "Search" });
    expect(box).toHaveAttribute("placeholder", "search");
    await userEvent.type(box, "s");
    expect(onSearch).toHaveBeenCalledWith("s");
  });
});
