import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { WzLocalGrid, localGridView, nextGridSort, type WzGridColumn } from "./local-grid";

interface Row {
  id: string;
  name: string;
  city?: string;
  total: number;
}

const COLUMNS: WzGridColumn<Row>[] = [
  { id: "id", label: "Id", width: 130, render: (r) => r.id, sortValue: (r) => r.id, searchText: (r) => r.id },
  { id: "name", label: "Name", render: (r) => r.name, sortValue: (r) => r.name, searchText: (r) => r.name },
  { id: "city", label: "City", render: (r) => r.city ?? "", sortValue: (r) => r.city, searchText: (r) => r.city },
  { id: "total", label: "Total", render: (r) => r.total.toFixed(2), sortValue: (r) => r.total },
];

const ROWS: Row[] = [
  { id: "A1", name: "Tanner Brady", city: "Corona", total: 100 },
  { id: "B2", name: "Carter McKay", city: "Philadelphia", total: 9.5 },
  { id: "C3", name: "Arjun Mali", total: 20 },
];

describe("localGridView — a client-side react-table: search, sort, pages", () => {
  it("searches every searchable column, any case, trimmed", () => {
    const v = localGridView(ROWS, COLUMNS, { query: "  phila ", sort: null, page: 1, size: 10 });
    expect(v.rows.map((r) => r.id)).toEqual(["B2"]);
    expect(v.total).toBe(1);
    // Total is not searchable.
    expect(localGridView(ROWS, COLUMNS, { query: "100", sort: null, page: 1, size: 10 }).total).toBe(0);
  });

  it("sorts numbers as numbers and text as text; blanks last either way", () => {
    const asc = localGridView(ROWS, COLUMNS, { query: "", sort: { id: "total", dir: "asc" }, page: 1, size: 10 });
    expect(asc.rows.map((r) => r.id)).toEqual(["B2", "C3", "A1"]);
    const desc = localGridView(ROWS, COLUMNS, { query: "", sort: { id: "city", dir: "desc" }, page: 1, size: 10 });
    expect(desc.rows.map((r) => r.id)).toEqual(["B2", "A1", "C3"]);
    const cityAsc = localGridView(ROWS, COLUMNS, { query: "", sort: { id: "city", dir: "asc" }, page: 1, size: 10 });
    expect(cityAsc.rows.map((r) => r.id)).toEqual(["A1", "B2", "C3"]);
  });

  it("pages: from / to / pages, and a page past the end comes back to the last", () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ id: `R${i}`, name: `n${i}`, total: i }));
    expect(localGridView(many, COLUMNS, { query: "", sort: null, page: 2, size: 10 })).toMatchObject({ page: 2, pages: 2, from: 11, to: 12, total: 12 });
    expect(localGridView(many, COLUMNS, { query: "", sort: null, page: 9, size: 5 })).toMatchObject({ page: 3, pages: 3, from: 11, to: 12 });
    expect(localGridView([], COLUMNS, { query: "", sort: null, page: 1, size: 10 })).toMatchObject({ page: 1, pages: 1, from: 0, to: 0, total: 0 });
  });

  it("nextGridSort: a new column sorts ascending, the same one flips", () => {
    expect(nextGridSort(null, "name")).toEqual({ id: "name", dir: "asc" });
    expect(nextGridSort({ id: "name", dir: "asc" }, "name")).toEqual({ id: "name", dir: "desc" });
    expect(nextGridSort({ id: "name", dir: "desc" }, "name")).toEqual({ id: "name", dir: "asc" });
    expect(nextGridSort({ id: "name", dir: "desc" }, "total")).toEqual({ id: "total", dir: "asc" });
  });
});

describe("WzLocalGrid — Workiz's grid under a client-page tab", () => {
  it("draws the strip (Search, page size 10), the header, the rows padded to ten, and the footer", () => {
    render(<WzLocalGrid label="Jobs" columns={COLUMNS} rows={ROWS} rowKey={(r) => r.id} searchLabel="Search jobs" />);
    expect(screen.getByRole("searchbox", { name: "Search jobs" })).toHaveAttribute("placeholder", "Search");
    const size = screen.getByRole("combobox", { name: "Rows per page" });
    expect(size).toHaveValue("10");
    expect(within(size).getAllByRole("option").map((o) => o.textContent)).toEqual(["5", "10", "20", "25", "50", "100"]);

    const table = screen.getByRole("table", { name: "Jobs" });
    expect(within(table).getAllByRole("columnheader").map((h) => h.textContent)).toEqual(["Id", "Name", "City", "Total"]);
    // 3 rows + 7 blank ones (hidden from the a11y tree).
    expect(within(table).getAllByRole("row")).toHaveLength(4);
    expect(table.querySelectorAll("tbody tr")).toHaveLength(10);
    expect(screen.getByTestId("list-pagination")).toHaveTextContent("Showing 1 to 3 of 3 results");
    expect(screen.getByTestId("list-pagination")).toHaveTextContent("Page 1 of 1");
  });

  it("a header sorts on click and shows Workiz's bar through aria-sort", async () => {
    render(<WzLocalGrid label="Jobs" columns={COLUMNS} rows={ROWS} rowKey={(r) => r.id} defaultSort={{ id: "total", dir: "desc" }} />);
    const table = screen.getByRole("table", { name: "Jobs" });
    expect(within(table).getByRole("columnheader", { name: "Total" })).toHaveAttribute("aria-sort", "descending");
    expect(within(table).getAllByRole("row").slice(1).map((r) => r.firstChild?.textContent)).toEqual(["A1", "C3", "B2"]);

    await userEvent.click(within(table).getByRole("button", { name: "Name" }));
    expect(within(table).getByRole("columnheader", { name: "Name" })).toHaveAttribute("aria-sort", "ascending");
    expect(within(table).getByRole("columnheader", { name: "Total" })).not.toHaveAttribute("aria-sort");
    expect(within(table).getAllByRole("row").slice(1).map((r) => r.firstChild?.textContent)).toEqual(["C3", "B2", "A1"]);
  });

  it("searches as you type and says No Records Found over the blank rows", async () => {
    render(<WzLocalGrid label="Jobs" columns={COLUMNS} rows={ROWS} rowKey={(r) => r.id} />);
    await userEvent.type(screen.getByRole("searchbox", { name: "Search" }), "zzz");
    expect(screen.getByText("No Records Found")).toBeInTheDocument();
    expect(screen.getByTestId("list-pagination")).toHaveTextContent("Showing 1 to 0 of 0 results");
  });

  it("pages with the arrows and the size box; a row click reaches the caller", async () => {
    const onRowClick = vi.fn();
    const many = Array.from({ length: 12 }, (_, i) => ({ id: `R${String(i).padStart(2, "0")}`, name: `n${i}`, total: i }));
    render(<WzLocalGrid label="Jobs" columns={COLUMNS} rows={many} rowKey={(r) => r.id} onRowClick={onRowClick} />);
    const pager = screen.getByTestId("list-pagination");
    expect(pager).toHaveTextContent("Page 1 of 2");
    await userEvent.click(within(pager).getByRole("button", { name: "Next page" }));
    expect(pager).toHaveTextContent("Showing 11 to 12 of 12 results");
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Rows per page" }), "20");
    expect(pager).toHaveTextContent("Showing 1 to 12 of 12 results");

    await userEvent.click(screen.getByText("R03"));
    expect(onRowClick).toHaveBeenCalledWith(many[3], expect.anything());
  });

  it("can leave the Search and the page size out, keeping Workiz's empty strip (Blocked callers)", () => {
    const { container } = render(<WzLocalGrid label="Blocked callers" columns={COLUMNS} rows={ROWS} rowKey={(r) => r.id} search={false} />);
    expect(screen.queryByRole("searchbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "Rows per page" })).not.toBeInTheDocument();
    expect(container.querySelector("[data-slot=wz-local-grid-strip]")).toBeInTheDocument();
    expect(screen.getByTestId("list-pagination")).toHaveTextContent("Showing 1 to 3 of 3 results");
  });

  it("puts the caller's toolbar pieces after the search box", () => {
    render(<WzLocalGrid label="Invoices" columns={COLUMNS} rows={ROWS} rowKey={(r) => r.id} toolbar={<button type="button">Pay unpaid invoices</button>} />);
    expect(screen.getByRole("button", { name: "Pay unpaid invoices" })).toBeInTheDocument();
  });

  it("opens at the caller's page size (Workiz's Sub Status opens at 50)", () => {
    render(<WzLocalGrid label="Sub statuses" columns={COLUMNS} rows={ROWS} rowKey={(r) => r.id} defaultPageSize={50} />);
    expect(screen.getByRole("combobox", { name: "Rows per page" })).toHaveValue("50");
  });

  it("can keep the pager inside the grid's frame, as the settings grids do", () => {
    const { container, rerender } = render(<WzLocalGrid label="Jobs" columns={COLUMNS} rows={ROWS} rowKey={(r) => r.id} />);
    const frame = () => container.querySelector("[data-slot=wz-local-grid-frame]")!;
    expect(frame().contains(screen.getByTestId("list-pagination"))).toBe(false);
    rerender(<WzLocalGrid label="Jobs" columns={COLUMNS} rows={ROWS} rowKey={(r) => r.id} pagerInside />);
    expect(frame().contains(screen.getByTestId("list-pagination"))).toBe(true);
  });

  it("says the caller's words over an empty grid, or nothing at all (emptyText)", () => {
    const { rerender } = render(
      <WzLocalGrid
        label="Call groups"
        columns={COLUMNS}
        rows={[]}
        rowKey={(r) => r.id}
        emptyText={
          <>
            <b>No call groups created</b> Forward calls to multiple users
          </>
        }
      />,
    );
    expect(screen.getByRole("status")).toHaveTextContent("No call groups created Forward calls to multiple users");
    expect(screen.queryByText("No Records Found")).not.toBeInTheDocument();
    rerender(<WzLocalGrid label="Numbers" columns={COLUMNS} rows={[]} rowKey={(r) => r.id} emptyText={null} />);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});
