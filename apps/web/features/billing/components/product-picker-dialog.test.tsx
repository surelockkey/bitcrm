import { describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { InventoryStatus, ProductType, type Product } from "@bitcrm/types";
import { renderWithClient } from "@/test/render-with-client";

const catalog = vi.hoisted(() => ({ products: [] as unknown[] }));
vi.mock("@/features/inventory/warehouses/api", () => ({
  fetchAllProducts: () => Promise.resolve(catalog.products),
}));

import { ProductPickerDialog } from "./product-picker-dialog";

const product = (over: Partial<Product>): Product =>
  ({
    id: "p1", name: "Deadbolt", sku: "DB-1", type: ProductType.PRODUCT, status: InventoryStatus.ACTIVE,
    costCompany: 20, costTech: 25, priceClient: 100, taxable: true, ...over,
  }) as Product;

catalog.products = [
  product({}),
  product({ id: "p2", name: "Rekey service", sku: "SVC-1", type: ProductType.SERVICE, taxable: false, priceClient: 50 }),
  product({ id: "p3", name: "Old lock", sku: "OLD", status: InventoryStatus.ARCHIVED }),
];

const user = () => userEvent.setup({ pointerEventsCheck: 0 });

describe("ProductPickerDialog", () => {
  it("lists active catalog items and filters by search", async () => {
    renderWithClient(<ProductPickerDialog open onOpenChange={() => {}} onSubmit={() => {}} />);
    expect(await screen.findByText("Deadbolt")).toBeInTheDocument();
    expect(screen.queryByText("Old lock")).not.toBeInTheDocument();
    await user().type(screen.getByPlaceholderText(/search catalog/i), "svc");
    expect(screen.queryByText("Deadbolt")).not.toBeInTheDocument();
    expect(screen.getByText("Rekey service")).toBeInTheDocument();
  });

  it("configures and submits a line with the catalog's taxable default", async () => {
    const onSubmit = vi.fn();
    renderWithClient(<ProductPickerDialog open onOpenChange={() => {}} onSubmit={onSubmit} />);
    const u = user();
    await u.click(await screen.findByText("Rekey service"));
    const qty = screen.getByLabelText("Quantity");
    await u.clear(qty);
    await u.type(qty, "3");
    await u.type(screen.getByLabelText(/description/i), "Front and back");
    await u.click(screen.getByRole("button", { name: /^add item$/i }));
    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith({
        productId: "p2", productType: ProductType.SERVICE, name: "Rekey service", sku: "SVC-1",
        description: "Front and back", quantity: 3, priceClient: 50, costCompany: 20, costForTech: 25,
        taxable: false,
      }),
    );
  });

  it("blocks a price outside the ±15% band", async () => {
    const onSubmit = vi.fn();
    renderWithClient(<ProductPickerDialog open onOpenChange={() => {}} onSubmit={onSubmit} />);
    const u = user();
    await u.click(await screen.findByText("Deadbolt"));
    const price = screen.getByLabelText("Client price");
    await u.clear(price);
    await u.type(price, "200");
    expect(screen.getByRole("button", { name: /^add item$/i })).toBeDisabled();
  });
});
