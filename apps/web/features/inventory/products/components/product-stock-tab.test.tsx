import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { ProductStock } from "../stock";
import { ProductStockTab } from "./product-stock-tab";

const stock: ProductStock = {
  rows: [
    { id: "w1", name: "WAREHOUSE TX", kind: "warehouse", quantity: 240 },
    { id: "c1", name: "Van 1", subtitle: "Connecticut", kind: "container", quantity: 6 },
  ],
  total: 246,
  loading: false,
  listsLoading: false,
  isError: false,
  isEmpty: false,
};

vi.mock("../stock", () => ({ useProductStock: () => stock }));

describe("ProductStockTab", () => {
  it("lists every location holding the item, with its count", () => {
    render(<ProductStockTab productId="p1" minStockLevel={10} serviceType={false} />);
    expect(screen.getByText("WAREHOUSE TX")).toBeInTheDocument();
    expect(screen.getByText("Van 1")).toBeInTheDocument();
    expect(screen.getByText("240")).toBeInTheDocument();
  });
});

/**
 * Ширину колонки задає колонка, а не вміст: `table-fixed` плюс `<colgroup>`,
 * межу можна перетягнути, і таблиця цю ширину пам'ятає між візитами.
 */
describe("ProductStockTab — a stable first frame", () => {
  const table = () =>
    render(<ProductStockTab productId="p1" minStockLevel={10} serviceType={false} />)
      .container;

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
    for (const id of ["location", "type", "onHand"]) {
      expect(screen.getByTestId(`resize-${id}`)).toBeInTheDocument();
    }
  });
});
