import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { InventoryStatus } from "@bitcrm/types";
import type { Container } from "@bitcrm/types";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { ContainerUser } from "@/features/inventory/user-containers/lib";
import type { LocationTotals } from "@/features/inventory/stock/lib";
import { INVENTORY_ROW } from "@/features/inventory/components/inventory-table";
import { ContainersTable } from "./containers-table";

const onEdit = vi.fn();
const onStock = vi.fn();

function container(over: Partial<Container & LocationTotals>): Container & LocationTotals {
  return {
    id: "c1",
    name: "Van 1",
    description: "Ford Transit",
    technicianId: "t1",
    technicianName: "TYLER BOUCHER",
    department: "Connecticut",
    status: InventoryStatus.ACTIVE,
    createdAt: "",
    updatedAt: "",
    ...over,
  };
}

/** Who works from each van, as the page works it out from the assignments. */
let users: Map<string, ContainerUser[]>;

// Deliberately no QueryClientProvider: the table reads nothing on its own —
// a row that fired a request would throw here for want of a client.
function renderTable(containers: Container[] = [container({})]) {
  return render(
    <TooltipProvider>
      <ContainersTable containers={containers} users={users} onEdit={onEdit} onStock={onStock} />
    </TooltipProvider>,
  );
}

beforeEach(() => {
  users = new Map([["c1", [{ userId: "t1", name: "TYLER BOUCHER" }]]]);
  onEdit.mockClear();
  onStock.mockClear();
});

describe("ContainersTable", () => {
  it("has Workiz's columns, in order", () => {
    renderTable();
    expect([...document.querySelectorAll("thead th")].map((th) => th.textContent)).toEqual([
      "Name",
      "Description",
      "Users",
      "Department",
      "Items",
      "SKUs",
      "Actions",
    ]);
  });

  it("renders name, description, its users, department, and the totals the server keeps on the row", () => {
    renderTable([container({ totalUnits: 1244, uniqueItems: 40 })]);
    expect(screen.getByText("Van 1")).toBeInTheDocument();
    expect(screen.getByText("Ford Transit")).toBeInTheDocument();
    expect(screen.getByText("TYLER BOUCHER")).toBeInTheDocument();
    expect(screen.getByText("Connecticut")).toBeInTheDocument();
    const cells = document.querySelectorAll("tbody td");
    expect(cells[4]).toHaveTextContent(/^1,244$/);
    expect(cells[5]).toHaveTextContent(/^40$/);
  });

  // The backfill has not reached this van yet: "—", never a 0 nobody counted,
  // and never a request per row to count it in the browser.
  it("shows — for totals the server has not filled in yet", () => {
    renderTable([container({})]);
    const cells = document.querySelectorAll("tbody td");
    expect(cells[4]).toHaveTextContent(/^—$/);
    expect(cells[5]).toHaveTextContent(/^—$/);
  });

  it("counts an empty van as 0, not —", () => {
    renderTable([container({ totalUnits: 0, uniqueItems: 0 })]);
    const cells = document.querySelectorAll("tbody td");
    expect(cells[4]).toHaveTextContent(/^0$/);
    expect(cells[5]).toHaveTextContent(/^0$/);
  });

  it("left-aligns everything — headers, cells, numbers and the actions", () => {
    renderTable();
    for (const el of document.querySelectorAll("th, td, td *")) {
      expect(el.getAttribute("class") ?? "").not.toMatch(/text-right|justify-end/);
    }
  });

  // A van may be shared: the cell names the first two and counts the rest.
  it("names the first two users of a shared van and counts the rest", () => {
    users = new Map([
      [
        "c1",
        [
          { userId: "u1", name: "Anna Lys" },
          { userId: "u2", name: "Bohdan Hai" },
          { userId: "u3", name: "Iryna Sad" },
          { userId: "u4" },
        ],
      ],
    ]);
    renderTable();
    expect(document.querySelectorAll("tbody td")[2]).toHaveTextContent("Anna Lys, Bohdan Hai +2");
  });

  it("shows — for a van nobody works from, and — without a description", () => {
    users = new Map();
    renderTable([container({ technicianId: undefined, technicianName: undefined, description: undefined })]);
    expect(document.querySelectorAll("tbody td")[2]).toHaveTextContent(/^—$/);
    expect(document.querySelectorAll("tbody td")[1]).toHaveTextContent("—");
  });

  // Low stock needs the van's whole stock; that lives in its Stock popup. On
  // the row it arrived late, per row, and made each row taller as it did.
  it("has no Low stock badge on the row", () => {
    renderTable([container({ totalUnits: 3, uniqueItems: 1 })]);
    expect(screen.queryByText("Low stock")).not.toBeInTheDocument();
  });

  it("renders a hundred rows without a single request of its own", () => {
    const many = Array.from({ length: 100 }, (_, i) => container({ id: `c${i}`, name: `Van ${i}` }));
    renderTable(many);
    expect(document.querySelectorAll("tbody tr")).toHaveLength(100);
  });

  it("opens the van's stock on row click", async () => {
    renderTable();
    await userEvent.click(screen.getByText("Van 1"));
    expect(onStock).toHaveBeenCalledWith(expect.objectContaining({ id: "c1" }));
    expect(onEdit).not.toHaveBeenCalled();
  });

  it("opens the Edit popup from the pencil, without also opening the stock", async () => {
    renderTable();
    await userEvent.click(screen.getByRole("button", { name: "Edit Van 1" }));
    expect(onEdit).toHaveBeenCalledWith(expect.objectContaining({ id: "c1" }));
    expect(onStock).not.toHaveBeenCalled();
  });

  it("opens the stock popup from the box button, once", async () => {
    renderTable();
    await userEvent.click(screen.getByRole("button", { name: "Stock in Van 1" }));
    expect(onStock).toHaveBeenCalledTimes(1);
    expect(onEdit).not.toHaveBeenCalled();
  });

  it("has no archive action on the row — Active lives in the Edit popup", () => {
    renderTable();
    expect(screen.queryByRole("button", { name: /Archive/ })).not.toBeInTheDocument();
  });
});

/**
 * Ширину колонки задає колонка, а не вміст: `table-fixed` плюс `<colgroup>`,
 * межу можна перетягнути, і таблиця цю ширину пам'ятає між візитами.
 */
describe("ContainersTable — a stable first frame", () => {
  const table = () => renderTable().container;

  it("scrolls sideways instead of clipping when the columns outgrow the screen", () => {
    const frame = table().querySelector("[data-slot=table-frame]") as HTMLElement;
    expect(frame).not.toBeNull();
    expect(frame.className).toMatch(/overflow-x-auto/);
    expect(frame.className).not.toMatch(/overflow-hidden/);
  });

  it("lays the columns out at declared widths, not by content", () => {
    expect(table().querySelector("table")?.className).toContain("table-fixed");
  });

  it("declares a width for every column", () => {
    const c = table();
    const cols = [...c.querySelectorAll("colgroup col")];
    expect(cols).toHaveLength(c.querySelectorAll("thead th").length);
    for (const col of cols) expect((col as HTMLElement).style.width).not.toBe("");
  });

  // `min-w` на комірці б'є оголошену ширину й зсуває рядок убік.
  it("leaves the width to the column — no cell sets one of its own", () => {
    for (const el of table().querySelectorAll("thead th, tbody td")) {
      expect(el.className).not.toMatch(/(^|\s)(min-)?w-/);
    }
  });

  it("clips every cell rather than letting it spill into the next column", () => {
    for (const td of table().querySelectorAll("tbody td")) {
      expect(td.className).toMatch(/truncate|overflow-hidden/);
    }
  });

  it("offers a drag handle on every header", () => {
    table();
    for (const id of ["name", "description", "users", "department", "items", "skus", "actions"]) {
      expect(screen.getByTestId(`resize-${id}`)).toBeInTheDocument();
    }
  });
});

/**
 * Loading, the table is itself: the same header and column widths, a page of
 * rows as tall as the real ones — so nothing moves when the vans arrive.
 */
describe("ContainersTable — loading", () => {
  const shape = () => ({
    headers: [...document.querySelectorAll("thead th")].map((th) => th.textContent),
    widths: [...document.querySelectorAll("col")].map((c) => (c as HTMLElement).style.width),
  });

  it("has the same columns, at the same widths, as the loaded table", () => {
    const { unmount } = renderTable();
    const loaded = shape();
    unmount();

    render(
      <TooltipProvider>
        <ContainersTable containers={[]} users={users} onEdit={onEdit} onStock={onStock} loading skeletonRows={50} />
      </TooltipProvider>,
    );
    expect(shape()).toEqual(loaded);
    expect(screen.getAllByTestId("skeleton-row")).toHaveLength(50);
  });

  it("gives real rows the skeleton's height", () => {
    renderTable();
    expect(document.querySelector("tbody tr")?.className).toContain(INVENTORY_ROW);
  });
});
