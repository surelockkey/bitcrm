import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
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

  it("can stay silent over an empty report — Workiz's Call Tracking prints nothing over its blank rows", () => {
    render(<WzReportGrid aria-label="Activity" columns={columns} rows={[]} rowKey={(r) => r.id} emptyText={null} />);
    expect(screen.queryByText("No Records Found")).toBeNull();
    expect(document.querySelector('[data-slot="wz-table-no-data"]')).toBeNull();
    expect(document.querySelectorAll("tbody tr[aria-hidden]")).toHaveLength(10);
  });

  it("emptyText={null}: only the blank rows, no band — Workiz's Team list (pg_technicians_wz_07_search_empty)", () => {
    render(<WzReportGrid aria-label="Activity" columns={columns} rows={[]} rowKey={(r) => r.id} emptyText={null} minRows={5} />);
    expect(document.querySelector("[data-slot=wz-table-no-data]")).toBeNull();
    expect(screen.queryByText("No Records Found")).toBeNull();
    expect(document.querySelectorAll("tbody tr[aria-hidden]")).toHaveLength(5);
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

  // pg_invoices_wz_01_default: the Invoices list's `rt-tr-group pointer` — the
  // whole record opens the invoice; the blank filler rows open nothing.
  it("opens a record from anywhere on its row — click, middle click or Enter — and only records", async () => {
    const onRowClick = vi.fn();
    render(<WzReportGrid aria-label="Activity" columns={columns} rows={rows} rowKey={(r) => r.id} onRowClick={onRowClick} />);
    const [first, second] = bodyRows();
    expect(first).toHaveClass("cursor-pointer");
    await userEvent.click(within(second).getByText("Tom"));
    expect(onRowClick).toHaveBeenLastCalledWith(rows[1], expect.objectContaining({ type: "click" }));
    first.focus();
    await userEvent.keyboard("{Enter}");
    expect(onRowClick).toHaveBeenLastCalledWith(rows[0], expect.objectContaining({ key: "Enter" }));
    await userEvent.pointer({ keys: "[MouseMiddle]", target: second });
    expect(onRowClick).toHaveBeenLastCalledWith(rows[1], expect.objectContaining({ button: 1 }));
    onRowClick.mockClear();
    await userEvent.click(document.querySelector("tbody tr[aria-hidden]")!);
    expect(onRowClick).not.toHaveBeenCalled();
  });

  it("leaves rows inert without onRowClick", () => {
    render(<WzReportGrid aria-label="Activity" columns={columns} rows={rows} rowKey={(r) => r.id} />);
    expect(bodyRows()[0]).not.toHaveClass("cursor-pointer");
    expect(bodyRows()[0]).not.toHaveAttribute("tabindex");
  });

  // Workiz's headers are react-table's `rt-resizable-header`: an edge to drag.
  it("puts a drag handle on every header and lays the columns out at the widths it is given", async () => {
    const setWidth = vi.fn();
    const widths: Record<string, number> = { time: 180, who: 120 };
    render(
      <WzReportGrid
        aria-label="Activity"
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        sort={{ column: "time", dir: "desc" }}
        resize={{ widthOf: (id) => widths[id], setWidth, reset: () => {} }}
      />,
    );
    const cols = [...document.querySelectorAll("colgroup col")] as HTMLElement[];
    expect(cols.map((c) => c.style.width)).toEqual(["180px", "120px"]);
    expect(screen.getByTestId("resize-time")).toHaveAttribute("aria-valuenow", "180");
    expect(screen.getByTestId("resize-who")).toBeInTheDocument();
    // The sorted column keeps its bar and its name.
    expect(screen.getByRole("columnheader", { name: "Time" })).toHaveAttribute("aria-sort", "descending");
    screen.getByTestId("resize-who").focus();
    await userEvent.keyboard("{ArrowRight}");
    expect(setWidth).toHaveBeenCalledWith("who", 136);
  });
});

describe("WzReportGrid cellAlign (pg_pricebook)", () => {
  it("centres every record cell vertically when asked — Workiz's price book rows (align-items: center)", () => {
    render(<WzReportGrid aria-label="Activity" columns={columns} rows={rows} rowKey={(r) => r.id} cellAlign="middle" />);
    const cells = bodyRows()[0].querySelectorAll("td");
    expect([...cells].every((td) => td.className.includes("align-middle") && !td.className.includes("align-top"))).toBe(true);
  });

  it("keeps the report's top-aligned cells by default", () => {
    render(<WzReportGrid aria-label="Activity" columns={columns} rows={rows} rowKey={(r) => r.id} />);
    expect(bodyRows()[0].querySelector("td")!.className).toContain("align-top");
  });
});

describe("WzReportGrid minTableWidth (pg_inventory)", () => {
  // Workiz's Inventory grid: twenty 100px columns (2030px) in a 1400px frame —
  // the grid scrolls sideways inside its frame instead of squeezing them, with
  // the header pinned to the page's top and moving sideways with the rows (the
  // 2026-10-09 probes: Workiz's page never scrolls sideways; its `rt-thead` is
  // sticky and translated by the rows' scroll). A sticky header INSIDE the
  // sideways box was trapped by it — so, as `WzScrollGrid`: the header in a
  // box of its own over the rows' box, both on the same columns.
  const grid = (props: Partial<React.ComponentProps<typeof WzReportGrid<Row>>> = {}) =>
    render(<WzReportGrid aria-label="Activity" columns={columns} rows={rows} rowKey={(r) => r.id} minTableWidth={2030} {...props} />);

  it("holds the rows' table at its width in a box that scrolls sideways; the frame and the pager stay put", () => {
    grid();
    const table = screen.getByRole("table", { name: "Activity" });
    expect(table.style.minWidth).toBe("2030px");
    expect(table.closest("[data-slot=wz-report-grid-body]")!.className).toContain("overflow-x-auto");
    expect(table.closest("[data-slot=wz-report-grid]")!.className).not.toContain("overflow-x-auto");
    expect(document.querySelectorAll(".overflow-x-auto")).toHaveLength(1);
  });

  it("pins the header to the page's top in a box of its own, on the same columns, and moves it with the rows", () => {
    const { container } = grid();
    const head = container.querySelector("[data-slot=wz-report-grid-head]") as HTMLElement;
    const body = container.querySelector("[data-slot=wz-report-grid-body]") as HTMLElement;
    expect(head.className).toMatch(/\bsticky\b/);
    expect(head.className).toMatch(/\btop-0\b/);
    expect(head.className).toMatch(/\boverflow-hidden\b/);
    expect(within(head).getAllByRole("columnheader").map((h) => h.textContent)).toEqual(["Time", "User"]);
    // The cells no longer stick on their own: the box does.
    for (const th of head.querySelectorAll("th")) expect(th.className).not.toMatch(/\bsticky\b/);
    expect((head.querySelector("table") as HTMLElement).style.minWidth).toBe("2030px");
    body.scrollLeft = 300;
    fireEvent.scroll(body);
    expect(head.scrollLeft).toBe(300);
  });

  it("keeps the header off the page's top when told so (stickyHeader false)", () => {
    const { container } = grid({ stickyHeader: false });
    expect(container.querySelector("[data-slot=wz-report-grid-head]")!.className).not.toMatch(/\bsticky\b/);
  });

  it("tells a screen reader the rows' columns too, without a second visible header", () => {
    grid();
    const heads = within(screen.getByRole("table", { name: "Activity" })).getAllByRole("columnheader");
    expect(heads.map((h) => h.textContent)).toEqual(["Time", "User"]);
    expect(heads[0].closest("thead")?.className).toContain("sr-only");
  });

  it("still sorts from the pinned header", async () => {
    const onSort = vi.fn();
    grid({ onSort });
    await userEvent.click(screen.getByRole("button", { name: "Sort by Time" }));
    expect(onSort).toHaveBeenCalledWith("time");
  });

  it("leaves every grid without it exactly as it was", () => {
    render(<WzReportGrid aria-label="Activity" columns={columns} rows={rows} rowKey={(r) => r.id} />);
    const table = screen.getByRole("table", { name: "Activity" });
    expect(table.style.minWidth).toBe("");
    expect(table.closest("[data-slot=wz-report-grid]")!.className).not.toContain("overflow-x-auto");
    expect(document.querySelector("[data-slot=wz-report-grid-head]")).toBeNull();
    expect(document.querySelectorAll("table")).toHaveLength(1);
    expect(table.querySelector("thead th")!.className).toMatch(/\bsticky\b/);
  });
});

describe("WzReportGrid rowHeight (the one-load rule)", () => {
  // A record row on Workiz is as tall as what it holds — 80px beside a 40px
  // picture, 82px for a name over an email, 58px for a two-line time — while
  // the loader's blank rows are react-table's 56/57px: the records then land
  // lower than the blanks they replace and everything under them moves
  // (app_audit 2026-10-09: CLS 0.02–0.13 on twelve grids). Told the row
  // height, the grid gives it to the loader's blanks, the records and the
  // filler alike, so it is the same height before and after the rows come.
  const heights = () => [...document.querySelectorAll<HTMLElement>("tbody tr:not([hidden])")].map((tr) => tr.style.height);

  it("declares the same height on the loader's blank rows as on the records and the filler that follow", () => {
    const { rerender } = render(<WzReportGrid aria-label="Activity" columns={columns} rows={rows} rowKey={(r) => r.id} loading rowHeight={80} />);
    expect(heights()).toEqual(Array(10).fill("80px"));
    rerender(<WzReportGrid aria-label="Activity" columns={columns} rows={rows} rowKey={(r) => r.id} rowHeight={80} />);
    expect(heights()).toEqual(Array(10).fill("80px"));
    expect(screen.getByText("Ann").closest("tr")!.style.height).toBe("80px");
  });

  it("drops the blanks' own 56/57px classes, which would fight the height it was given", () => {
    const { rerender } = render(<WzReportGrid aria-label="Activity" columns={columns} rows={rows} rowKey={(r) => r.id} rowHeight={82} />);
    const pad = () => document.querySelector("tbody tr[aria-hidden] td")!;
    expect(pad().className).not.toMatch(/h-\[5[67]px\]/);
    // The faint rule is still the filler's (and plainFiller still takes it off under records).
    expect(pad().className).toContain("border-b-black/5");
    rerender(<WzReportGrid aria-label="Activity" columns={columns} rows={rows} rowKey={(r) => r.id} rowHeight={82} plainFiller />);
    expect(pad().className).not.toContain("border-b-black/5");
    expect(pad().className).not.toMatch(/h-\[5[67]px\]/);
  });

  it("gives the loader's blank cells the record cells' own classes — the same padding, the same alignment", () => {
    render(<WzReportGrid aria-label="Activity" columns={columns} rows={rows} rowKey={(r) => r.id} loading rowHeight={80} cellAlign="middle" />);
    const blank = document.querySelector("tbody tr[aria-hidden] td")!;
    expect(blank.className).toContain("p-5");
    expect(blank.className).toContain("align-middle");
    expect(blank.className).not.toContain("py-0");
  });

  it("sits the loader's dots in the grid's middle when the rows are taller than Workiz's blanks", () => {
    const { rerender } = render(<WzReportGrid aria-label="Activity" columns={columns} rows={rows} rowKey={(r) => r.id} loading rowHeight={80} />);
    const dots = () => screen.getByRole("status", { name: "Loading" }).firstElementChild!;
    expect(dots().className).toContain("top-1/2");
    // Workiz's own ten 56px blanks keep its measured 340px.
    rerender(<WzReportGrid aria-label="Activity" columns={columns} rows={rows} rowKey={(r) => r.id} loading rowHeight={56} />);
    expect(dots().className).toContain("top-[340px]");
  });

  // Chrome reported the filler rows under three warehouses moving 192px
  // (app_audit → probe_shift 2026-10-09): keyed by their index, the blanks
  // that were rows 1–3 while loading became rows 4–6 once the records went
  // in above them — the same elements, pushed down. Keyed by their slot, a
  // blank keeps the row it had, and the records take the blanks' places as
  // new elements: nothing on screen moves.
  it("keys a filler by its slot, so the blanks under the records are the rows they were while loading", () => {
    const { rerender } = render(<WzReportGrid aria-label="Activity" columns={columns} rows={rows} rowKey={(r) => r.id} loading rowHeight={80} />);
    const blanks = () => [...document.querySelectorAll<HTMLElement>("tbody tr[aria-hidden]")];
    const loadingRows = blanks();
    expect(loadingRows).toHaveLength(10);
    rerender(<WzReportGrid aria-label="Activity" columns={columns} rows={rows} rowKey={(r) => r.id} rowHeight={80} />);
    const fillers = blanks();
    expect(fillers).toHaveLength(8);
    // The eight fillers are the very elements that were rows 3–10 of the loader.
    expect(fillers).toEqual(loadingRows.slice(2));
    // And they sit where they sat: third row onwards.
    const body = document.querySelector("tbody")!;
    expect([...body.children].indexOf(fillers[0])).toBe(2);
  });

  it("leaves every grid without it exactly as it was — no declared heights at all", () => {
    const { rerender } = render(<WzReportGrid aria-label="Activity" columns={columns} rows={rows} rowKey={(r) => r.id} loading />);
    expect(heights().every((h) => h === "")).toBe(true);
    rerender(<WzReportGrid aria-label="Activity" columns={columns} rows={rows} rowKey={(r) => r.id} />);
    expect(heights().every((h) => h === "")).toBe(true);
    expect(document.querySelector("tbody tr[aria-hidden] td")!.className).toContain("h-[57px]");
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
