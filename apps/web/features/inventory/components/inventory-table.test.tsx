import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { TableCell, TableRow } from "@/components/ui/table";
import { InventoryTable, INVENTORY_ROW, type InventoryColumn } from "./inventory-table";

/**
 * The frame every inventory list is drawn in — loading, loaded or holding the
 * previous filter's rows. One component for all three is what keeps a table
 * from jumping when its rows land: the skeleton *is* the table, with the same
 * header, the same column widths and rows of the same height.
 */
const COLUMNS: InventoryColumn[] = [
  { id: "name", label: "Name", width: 240 },
  { id: "items", label: "Items", width: 110 },
  { id: "actions", label: "Actions", width: 100 },
];

const widths = () => [...document.querySelectorAll("col")].map((c) => (c as HTMLElement).style.width);
const headers = () => [...document.querySelectorAll("thead th")].map((th) => th.textContent);

function loaded() {
  return render(
    <InventoryTable tableKey="t" columns={COLUMNS}>
      <TableRow className={INVENTORY_ROW}>
        <TableCell>Van 1</TableCell>
        <TableCell>3</TableCell>
        <TableCell />
      </TableRow>
    </InventoryTable>,
  );
}

describe("InventoryTable", () => {
  it("draws the header and a column per entry, at its width", () => {
    loaded();
    expect(headers()).toEqual(["Name", "Items", "Actions"]);
    expect(widths()).toEqual(["240px", "110px", "100px"]);
  });

  it("loading, is the same table: same header, same column widths", () => {
    const { unmount } = loaded();
    const shape = { headers: headers(), widths: widths() };
    unmount();

    render(<InventoryTable tableKey="t" columns={COLUMNS} loading skeletonRows={50} />);

    expect({ headers: headers(), widths: widths() }).toEqual(shape);
  });

  it("loading, fills a whole page with rows as tall as the real ones", () => {
    render(<InventoryTable tableKey="t" columns={COLUMNS} loading skeletonRows={25} />);

    const rows = screen.getAllByTestId("skeleton-row");
    expect(rows).toHaveLength(25);
    for (const row of rows) {
      expect(row.querySelectorAll("td")).toHaveLength(COLUMNS.length);
      expect(row.className).toContain(INVENTORY_ROW);
    }
  });

  it("uses the table's own row height for its skeleton when it has taller rows", () => {
    render(
      <InventoryTable tableKey="t" columns={COLUMNS} loading skeletonRows={2} rowClassName="h-[3.25rem]" />,
    );
    for (const row of screen.getAllByTestId("skeleton-row")) expect(row.className).toContain("h-[3.25rem]");
  });

  it("says it is busy while loading", () => {
    render(<InventoryTable tableKey="t" columns={COLUMNS} loading skeletonRows={1} />);
    expect(screen.getByRole("table")).toHaveAttribute("aria-busy", "true");
  });

  // keepPreviousData: the old rows stay while the new filter loads — dimmed,
  // not swapped for a skeleton and back.
  it("dims the rows it holds over from the previous filter, and keeps them", () => {
    render(
      <InventoryTable tableKey="t" columns={COLUMNS} stale>
        <TableRow>
          <TableCell>Van 1</TableCell>
          <TableCell />
          <TableCell />
        </TableRow>
      </InventoryTable>,
    );
    expect(screen.getByText("Van 1")).toBeInTheDocument();
    expect(screen.getByRole("table")).toHaveAttribute("aria-busy", "true");
    expect(document.querySelector("tbody")?.className).toMatch(/opacity-/);
  });

  it("is not busy once its rows are in", () => {
    loaded();
    expect(screen.getByRole("table")).not.toHaveAttribute("aria-busy");
    expect(document.querySelector("tbody")?.className ?? "").not.toMatch(/opacity-/);
  });
});
