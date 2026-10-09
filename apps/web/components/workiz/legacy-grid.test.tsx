import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { WzLegacyGrid, type WzLegacyGridProps } from "./legacy-grid";

const COLUMNS = [
  { id: "job", label: "Job Id", sortable: true },
  { id: "total", label: "Total", sortable: true },
  { id: "rate", label: "Tech Share" },
];

function grid(over: Partial<WzLegacyGridProps> = {}) {
  const props: WzLegacyGridProps = {
    "aria-label": "Commissions",
    columns: COLUMNS,
    rows: [
      { key: "a", cells: ["S9QTU7", "335.67", "0%"] },
      { key: "b", cells: ["TF9KXK", "5,319.60", "1840.68$"] },
    ],
    totals: ["Totals:2", "5655.27", ""],
    sort: null,
    onSort: vi.fn(),
    pageSize: 50,
    pageSizes: [10, 25, 50, 100],
    onPageSize: vi.fn(),
    search: "",
    onSearch: vi.fn(),
    onRefresh: vi.fn(),
    info: "Showing 1 to 2 of 2 entries",
    onPrevious: undefined,
    onNext: undefined,
    ...over,
  };
  render(<WzLegacyGrid {...props} />);
  return props;
}

describe("WzLegacyGrid — Finance Reporting's DataTables grid", () => {
  it("the header, then the Totals row inside the head, then the rows", () => {
    grid();
    const rows = within(screen.getByRole("table", { name: "Commissions" })).getAllByRole("row");
    expect(rows[0]).toHaveTextContent("Job IdTotalTech Share");
    expect(rows[1]).toHaveTextContent("Totals:25655.27");
    expect(rows[2]).toHaveTextContent("S9QTU7335.670%");
    expect(rows).toHaveLength(4);
  });

  it("a sortable header sorts on a click and says how it is sorted; the sorted column is shaded", async () => {
    const props = grid({ sort: { id: "total", dir: "desc" } });
    expect(screen.getByRole("columnheader", { name: /Total/ })).toHaveAttribute("aria-sort", "descending");
    expect(screen.getByRole("columnheader", { name: /Job Id/ })).toHaveAttribute("aria-sort", "none");
    expect(screen.getByRole("cell", { name: "335.67" }).className).toContain("bg-[#f1f1f1]");
    await userEvent.click(screen.getByRole("button", { name: "Job Id" }));
    expect(props.onSort).toHaveBeenCalledWith("job");
    // Not every column sorts.
    expect(screen.queryByRole("button", { name: "Tech Share" })).toBeNull();
  });

  it("“Show [50] entries”, the reload button and the search box above it", async () => {
    const props = grid();
    const size = screen.getByRole("combobox", { name: "Show entries" });
    expect(size).toHaveValue("50");
    await userEvent.selectOptions(size, "100");
    expect(props.onPageSize).toHaveBeenCalledWith(100);
    await userEvent.click(screen.getByRole("button", { name: "Reload Results" }));
    expect(props.onRefresh).toHaveBeenCalled();
    await userEvent.type(screen.getByRole("searchbox", { name: "Search" }), "T");
    expect(props.onSearch).toHaveBeenCalledWith("T");
  });

  it("the line under it and Previous / Next, disabled where there is no page", async () => {
    const onNext = vi.fn();
    grid({ info: "Showing 1 to 50 of 244 entries (filtered from 50 total entries)", onNext });
    expect(screen.getByText("Showing 1 to 50 of 244 entries (filtered from 50 total entries)")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Previous" })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(onNext).toHaveBeenCalled();
  });

  it("no rows: No Records Found across the grid", () => {
    grid({ rows: [], totals: ["Totals:0", "", ""], info: "Showing 0 to 0 of 0 entries" });
    expect(screen.getByRole("cell", { name: "No Records Found" })).toHaveAttribute("colspan", "3");
  });
});
