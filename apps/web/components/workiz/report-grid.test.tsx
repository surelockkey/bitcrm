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
