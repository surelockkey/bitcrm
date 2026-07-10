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
    expect(push).toHaveBeenCalledWith("/inventory/products/p1");
  });
});
