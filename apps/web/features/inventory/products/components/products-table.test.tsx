import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { InventoryStatus, ProductType } from "@bitcrm/types";
import type { Product } from "@bitcrm/types";
import { ProductsTable } from "./products-table";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("@/features/auth/use-permissions", () => ({
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
 */
describe("ProductsTable — ширина колонок", () => {
  const longName =
    "Don-Jo - Mortise Remodeler Kit #109 - 630 - Silver (RPK-109-630) (SLK-12359)";

  it("caps the item column so a long name truncates instead of widening the table", () => {
    render(
      <ProductsTable
        products={[product({ name: longName })]}
        selected={new Set()}
        onToggle={vi.fn()}
        onToggleAll={vi.fn()}
      />,
    );

    const cell = screen.getByText(longName).closest("td")!;
    // `truncate` без стелі ширини не робить нічого: комірка просто росте.
    expect(cell.className).toMatch(/max-w-/);
  });

  it("keeps the checkbox column at its width when the row is wide", () => {
    render(
      <ProductsTable
        products={[product({ name: longName })]}
        selected={new Set()}
        onToggle={vi.fn()}
        onToggleAll={vi.fn()}
      />,
    );

    const head = screen.getByLabelText("Select all").closest("th")!;
    expect(head.className).toMatch(/min-w-/);
  });
});

