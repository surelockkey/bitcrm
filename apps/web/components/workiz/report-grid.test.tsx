import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { WzReportGrid, wzNextSort, type WzReportColumn } from "./report-grid";

interface Row {
  id: string;
  time: string;
  who: string;
}

const columns: WzReportColumn<Row>[] = [
  { id: "time", label: "Time", sortable: true, cell: (r) => r.time },
  { id: "who", label: "User", cell: (r) => <b>{r.who}</b> },
];

const rows: Row[] = [
  { id: "1", time: "Thu Oct 08, 2026 06:26 pm", who: "Ann" },
  { id: "2", time: "Thu Oct 08, 2026 06:25 pm", who: "Tom" },
];

const bodyRows = () => within(screen.getByRole("table", { name: "Activity" })).getAllByRole("row").slice(1);

describe("WzReportGrid", () => {
  it("prints the header and one row per record, cells from the columns", () => {
    render(<WzReportGrid aria-label="Activity" columns={columns} rows={rows} rowKey={(r) => r.id} />);
    const table = screen.getByRole("table", { name: "Activity" });
    expect(within(table).getAllByRole("columnheader").map((h) => h.textContent)).toEqual(["Time", "User"]);
    expect(bodyRows()[0]).toHaveTextContent("Thu Oct 08, 2026 06:26 pm");
    expect(within(bodyRows()[1]).getByText("Tom").tagName).toBe("B");
  });

  it("is never shorter than ten rows — react-table's blank filler rows", () => {
    render(<WzReportGrid aria-label="Activity" columns={columns} rows={rows} rowKey={(r) => r.id} />);
    expect(document.querySelectorAll("tbody tr")).toHaveLength(10);
    expect(document.querySelectorAll("tbody tr[aria-hidden]")).toHaveLength(8);
  });

  it("plainFiller: under records the blank rows are 56px with no rule; with no records they keep the rule", () => {
    // rep_tax_wz_01_default: five rows + five blanks, every row-group 56px, no
    // border; rep_tax_wz_11b_search_empty: ten blanks of 56 + a .05 rule.
    const { rerender } = render(<WzReportGrid aria-label="Activity" columns={columns} rows={rows} rowKey={(r) => r.id} plainFiller />);
    const pad = () => document.querySelector("tbody tr[aria-hidden] td")!;
    expect(pad().className).toContain("h-[56px]");
    expect(pad().className).not.toContain("border-b-black/5");
    rerender(<WzReportGrid aria-label="Activity" columns={columns} rows={[]} rowKey={(r) => r.id} plainFiller />);
    expect(pad().className).toContain("h-[57px]");
    expect(pad().className).toContain("border-b-black/5");
  });

  it("without plainFiller the blank rows keep their rule under records too (unchanged default)", () => {
    render(<WzReportGrid aria-label="Activity" columns={columns} rows={rows} rowKey={(r) => r.id} />);
    expect(document.querySelector("tbody tr[aria-hidden] td")!.className).toContain("h-[57px]");
  });

  it("says No Records Found over the blank rows when there is nothing", () => {
    render(<WzReportGrid aria-label="Activity" columns={columns} rows={[]} rowKey={(r) => r.id} />);
    expect(screen.getByText("No Records Found")).toBeInTheDocument();
    expect(document.querySelectorAll("tbody tr[aria-hidden]")).toHaveLength(10);
  });

  it("sorts only from a sortable header, and marks the sorted one", async () => {
    const onSort = vi.fn();
    const { rerender } = render(
      <WzReportGrid aria-label="Activity" columns={columns} rows={rows} rowKey={(r) => r.id} sort={null} onSort={onSort} />,
    );
    // Workiz opens unsorted: no bar, no aria-sort.
    expect(screen.getByRole("columnheader", { name: /Time/ })).not.toHaveAttribute("aria-sort");
    expect(screen.queryByRole("button", { name: "Sort by User" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Sort by Time" }));
    expect(onSort).toHaveBeenCalledWith("time");
    rerender(
      <WzReportGrid
        aria-label="Activity"
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        sort={{ column: "time", dir: "asc" }}
        onSort={onSort}
      />,
    );
    expect(screen.getByRole("columnheader", { name: /Time/ })).toHaveAttribute("aria-sort", "ascending");
  });

  // react-table's `.pagination-bottom` sits inside the grid's #ddd frame, right under the rows.
  it("holds the footer inside its frame, under the rows", () => {
    render(
      <WzReportGrid aria-label="Activity" columns={columns} rows={rows} rowKey={(r) => r.id} footer={<div>Showing 1 to 2 of 2 results</div>} />,
    );
    const frame = document.querySelector('[data-slot="wz-report-grid"]')!;
    expect(within(frame as HTMLElement).getByText("Showing 1 to 2 of 2 results")).toBeInTheDocument();
    expect(frame.lastElementChild).toHaveTextContent("Showing 1 to 2 of 2 results");
  });

  it("while loading, shows the header over blank rows and a loader — no records yet", () => {
    render(<WzReportGrid aria-label="Activity" columns={columns} rows={rows} rowKey={(r) => r.id} loading />);
    expect(screen.getByRole("status", { name: "Loading" })).toBeInTheDocument();
    expect(screen.queryByText("Ann")).toBeNull();
    expect(screen.queryByText("No Records Found")).toBeNull();
    expect(document.querySelectorAll("tbody tr[aria-hidden]")).toHaveLength(10);
  });

  // The Items report's ▸ (rep_items_wz_12c_drill): the item's jobs open in a
  // box under its row, across the whole grid; the zebra goes on counting
  // records, as react-table's rt-tr-group does.
  it("opens a record's box under its row, across every column, and keeps the zebra counting records", () => {
    render(
      <WzReportGrid
        aria-label="Activity"
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        renderExpanded={(r) => (r.id === "1" ? <p>Jobs of Ann</p> : null)}
      />,
    );
    const body = document.querySelector("tbody")!;
    const box = screen.getByText("Jobs of Ann").closest("td")!;
    expect(box).toHaveAttribute("colspan", "2");
    const annRow = screen.getByText("Ann").closest("tr")!;
    const tomRow = screen.getByText("Tom").closest("tr")!;
    expect(annRow.nextElementSibling).toBe(box.closest("tr"));
    // Ann is the first record (odd, grey), Tom the second (even) — the box does not shift him.
    const nth = (tr: Element) => [...body.children].indexOf(tr) + 1;
    expect(nth(annRow) % 2).toBe(1);
    expect(nth(tomRow) % 2).toBe(0);
    // Still ten records' worth of rows: two records, eight blanks.
    expect(body.querySelectorAll("tr[aria-hidden]:not([hidden])")).toHaveLength(8);
  });

  // rep_items_wz_11_empty_search: the Items report's blank rows are 56px with no rule under them.
  it("draws its blank rows without the faint rule when asked", () => {
    render(<WzReportGrid aria-label="Activity" columns={columns} rows={rows} rowKey={(r) => r.id} padRowRule={false} />);
    const blank = document.querySelector("tbody tr[aria-hidden] td")!;
    expect(blank).toHaveClass("h-[56px]");
    expect(blank.className).not.toMatch(/border-b-black/);
  });

  it("takes a row minimum of its own (the drill-down's five) and can leave its header unpinned", () => {
    render(<WzReportGrid aria-label="Activity" columns={columns} rows={rows} rowKey={(r) => r.id} minRows={5} stickyHeader={false} />);
    expect(document.querySelectorAll("tbody tr[aria-hidden]")).toHaveLength(3);
    expect(screen.getByRole("columnheader", { name: /Time/ }).className).not.toMatch(/\bsticky\b/);
  });

  // react-table's plain header (the Items report's "Item"): centred, regular weight.
  it("lets a column dress its header", () => {
    render(
      <WzReportGrid
        aria-label="Activity"
        columns={[{ ...columns[0], headerClassName: "text-center font-normal" }, columns[1]]}
        rows={rows}
        rowKey={(r) => r.id}
        onSort={() => {}}
      />,
    );
    expect(screen.getByRole("button", { name: "Sort by Time" })).toHaveClass("text-center", "font-normal");
    expect(screen.getByRole("button", { name: "Sort by Time" })).not.toHaveClass("text-left");
  });
});

describe("wzNextSort", () => {
  // react-table: the first click on an unsorted column sorts it ascending,
  // then each click turns it round (rep_activity_wz_08_sort_asc / _08b).
  it("goes unsorted → ascending → descending → ascending", () => {
    expect(wzNextSort(undefined)).toBe("asc");
    expect(wzNextSort("asc")).toBe("desc");
    expect(wzNextSort("desc")).toBe("asc");
  });
});
