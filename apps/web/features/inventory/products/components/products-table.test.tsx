import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { InventoryStatus, ProductType } from "@bitcrm/types";
import type { Product } from "@bitcrm/types";
import { ProductsTable } from "./products-table";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("@/features/auth/use-permissions", () => ({
  useDenied: () => () => false,
  usePermissions: () => ({ can: () => true }),
}));
vi.mock("../hooks", () => ({
  useArchiveProduct: () => ({ mutate: vi.fn(), isPending: false }),
  useReactivateProduct: () => ({ mutate: vi.fn(), isPending: false }),
}));

function product(over: Partial<Product>): Product {
  return {
    id: "p1",
    sku: "LOCK-001",
    name: "Deadbolt",
    category: "Locks",
    type: ProductType.PRODUCT,
    costCompany: 10,
    costTech: 18,
    priceClient: 45,
    serialTracking: false,
    minimumStockLevel: 5,
    status: InventoryStatus.ACTIVE,
    createdAt: "",
    updatedAt: "",
    ...over,
  };
}

const noop = () => {};

describe("ProductsTable", () => {
  it("renders name, SKU, client price and tech margin", () => {
    render(
      <ProductsTable
        products={[product({})]}
        selected={new Set()}
        onToggle={noop}
        onToggleAll={noop}
      />,
    );
    expect(screen.getByText("Deadbolt")).toBeInTheDocument();
    expect(screen.getByText(/LOCK-001/)).toBeInTheDocument();
    expect(screen.getByText("$45.00")).toBeInTheDocument();
    expect(screen.getByText("+150%")).toBeInTheDocument(); // 45 over tech 18
  });

  it("shows 'no stock' for services", () => {
    render(
      <ProductsTable
        products={[product({ id: "p2", type: ProductType.SERVICE, name: "Call-out" })]}
        selected={new Set()}
        onToggle={noop}
        onToggleAll={noop}
      />,
    );
    expect(screen.getByText("no stock")).toBeInTheDocument();
  });

  it("navigates to the editor on row click", async () => {
    render(
      <ProductsTable
        products={[product({})]}
        selected={new Set()}
        onToggle={noop}
        onToggleAll={noop}
      />,
    );
    await userEvent.click(screen.getByText("Deadbolt"));
    expect(push).toHaveBeenCalledWith("/inventory/items/p1");
  });
});

/**
 * Довга назва товару розсувала колонку «Item» на 739 із 1182 пікселів
 * контейнера — таблиця вилазила за рамку, а браузер, ділячи ширину, стискав
 * найменшу колонку: галочки з'їжджали на рамку й наліво від неї.
 *
 * Тепер ширину задає колонка, а не вміст: `table-fixed` плюс `<colgroup>` —
 * і межу можна перетягнути, а таблиця цю ширину пам'ятає.
 */
describe("ProductsTable — a stable first frame", () => {
  const longName =
    "Don-Jo - Mortise Remodeler Kit #109 - 630 - Silver (RPK-109-630) (SLK-12359)";

  const table = (over: Partial<Product> = {}) =>
    render(
      <ProductsTable
        products={[product(over)]}
        selected={new Set()}
        onToggle={vi.fn()}
        onToggleAll={vi.fn()}
      />,
    ).container;

  it("lays the columns out at declared widths, not by content", () => {
    expect(table().querySelector("table")?.className).toContain("table-fixed");
  });

  it("declares a width for every column", () => {
    const container = table();
    const cols = [...container.querySelectorAll("colgroup col")];
    expect(cols).toHaveLength(container.querySelectorAll("thead th").length);
    for (const col of cols) expect((col as HTMLElement).style.width).not.toBe("");
  });

  // Ширина живе в одному місці — в колонці. `min-w` на комірці б'є оголошену
  // ширину й зсуває рядок убік, хоч би що казав `<colgroup>`.
  it("leaves the width to the column — no cell sets one of its own", () => {
    const container = table({ name: longName });
    for (const el of container.querySelectorAll("thead th, tbody td")) {
      expect(el.className).not.toMatch(/(^|\s)(min-)?w-/);
    }
  });

  // Під `table-fixed` комірка, яка не ріже вміст, не розширює колонку — вона
  // вилазить на сусідню.
  it("clips every cell rather than letting it spill into the next column", () => {
    const container = table({ name: longName });
    for (const td of container.querySelectorAll("tbody td")) {
      expect(td.className).toMatch(/truncate|overflow-hidden/);
    }
  });

  it("offers a drag handle on every header", () => {
    table();
    for (const id of [
      "select",
      "item",
      "category",
      "type",
      "price",
      "minStock",
      "status",
      "actions",
    ]) {
      expect(screen.getByTestId(`resize-${id}`)).toBeInTheDocument();
    }
  });
});
