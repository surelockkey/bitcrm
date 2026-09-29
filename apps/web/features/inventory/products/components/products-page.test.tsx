import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { InventoryStatus, ProductType } from "@bitcrm/types";
import type { Product } from "@bitcrm/types";
import { renderWithClient } from "@/test/render-with-client";
import type { ProductFilter } from "../lib";

const mocks = vi.hoisted(() => ({ filters: [] as ProductFilter[], products: [] as Product[] }));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/features/auth/use-permissions", () => ({
  useDenied: () => () => false,
  usePermissions: () => ({ can: () => true }),
}));
vi.mock("../hooks", () => ({
  useProducts: (filter: ProductFilter) => {
    mocks.filters.push(filter);
    return {
      data: { pages: [{ data: mocks.products, pagination: {} }] },
      hasNextPage: false,
      isFetchingNextPage: false,
      isLoading: false,
      isError: false,
      fetchNextPage: vi.fn(),
      refetch: vi.fn(),
    };
  },
  useProductsCount: () => ({ data: { total: mocks.products.length, atLeast: false } }),
  useArchiveProduct: () => ({ mutate: vi.fn(), isPending: false }),
  useReactivateProduct: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock("./import-products-dialog", () => ({ ImportProductsDialog: () => null }));

import { ProductsPage } from "./products-page";

function product(over: Partial<Product> = {}): Product {
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

beforeEach(() => {
  mocks.filters = [];
  mocks.products = [product()];
});

describe("ProductsPage — filters combine", () => {
  it("keeps search and status usable while a type filter is on, and sends them together", async () => {
    renderWithClient(<ProductsPage />);

    await userEvent.click(screen.getAllByRole("combobox")[1]); // Type
    await userEvent.click(await screen.findByRole("option", { name: "Product" }));

    const search = screen.getByPlaceholderText("Search name or SKU");
    expect(search).toBeEnabled();
    await userEvent.type(search, "dead");

    expect(mocks.filters.at(-1)).toMatchObject({
      type: ProductType.PRODUCT,
      status: InventoryStatus.ACTIVE,
      search: "dead",
    });
    expect(screen.queryByText(/search and status are applied only without them/)).toBeNull();
  });

  it("keeps the category when a type is picked", async () => {
    renderWithClient(<ProductsPage />);

    await userEvent.click(screen.getAllByRole("combobox")[0]); // Category
    await userEvent.click(await screen.findByRole("option", { name: "Locks" }));
    await userEvent.click(screen.getAllByRole("combobox")[1]); // Type
    await userEvent.click(await screen.findByRole("option", { name: "Product" }));

    expect(mocks.filters.at(-1)).toMatchObject({ category: "Locks", type: ProductType.PRODUCT });
  });
});
