import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { InventoryStatus, ProductType } from "@bitcrm/types";
import type { DealProduct, Product } from "@bitcrm/types";

const mocks = vi.hoisted(() => ({
  add: vi.fn(),
  replace: vi.fn(),
  catalog: [] as unknown[],
  stock: new Map<string, number>(),
}));

vi.mock("../hooks", () => ({
  useAddProduct: () => ({ mutate: mocks.add, isPending: false }),
  useReplaceProduct: () => ({ mutate: mocks.replace, isPending: false }),
  useUserMap: () => ({
    map: new Map([["t1", { id: "t1", firstName: "Bob", lastName: "Wrench" }]]),
    users: [],
    isLoading: false,
  }),
}));

// The dialog reads the catalog and the tech's van stock through react-query;
// both resolve synchronously here.
vi.mock("@tanstack/react-query", () => ({
  useQuery: (opts: { queryKey: readonly unknown[] }) =>
    opts.queryKey[0] === "deal-tech-stock"
      ? { data: mocks.stock, isSuccess: true, isLoading: false, isError: false }
      : { data: mocks.catalog, isLoading: false },
}));

import { AddProductDialog } from "./add-product-dialog";

const product = (over: Partial<Product>): Product => ({
  id: "p1",
  sku: "KW-1",
  name: "Kwikset Deadbolt",
  category: "locks",
  type: ProductType.PRODUCT,
  costCompany: 10,
  costTech: 15,
  priceClient: 45,
  serialTracking: false,
  minimumStockLevel: 0,
  status: InventoryStatus.ACTIVE,
  createdAt: "",
  updatedAt: "",
  ...over,
});

const deadbolt = product({});
const schlage = product({ id: "p2", sku: "SC-2", name: "Schlage Lever", priceClient: 60 });

const editingLine: DealProduct = {
  productId: "p1",
  name: "Kwikset Deadbolt",
  sku: "KW-1",
  quantity: 2,
  costCompany: 10,
  costForTech: 15,
  priceClient: 40, // negotiated below the 45 catalog price
  fulfillment: "sourced",
  sourceTechId: "t1",
  addedBy: "u1",
  addedAt: "",
};

beforeEach(() => {
  mocks.add.mockClear();
  mocks.replace.mockClear();
  mocks.catalog = [deadbolt, schlage];
  mocks.stock = new Map([
    ["p1", 5],
    ["p2", 3],
  ]);
});

const dialog = (editing?: DealProduct) => (
  <AddProductDialog
    dealId="d1"
    techIds={["t1"]}
    open
    onOpenChange={vi.fn()}
    editing={editing}
  />
);

// Radix dialogs set pointer-events on <body> while open; skip the check in jsdom.
const user = () => userEvent.setup({ pointerEventsCheck: 0 });

describe("AddProductDialog (edit mode)", () => {
  it("opens on the configure step with the line's quantity and price prefilled", () => {
    render(dialog(editingLine));

    expect(screen.getByText("Edit item")).toBeInTheDocument();
    // Straight to configure — no catalog search box.
    expect(screen.queryByPlaceholderText(/search catalog/i)).toBeNull();
    expect(screen.getByDisplayValue("2")).toBeInTheDocument(); // quantity
    expect(screen.getByDisplayValue("40")).toBeInTheDocument(); // negotiated price
  });

  it("saves an in-place edit through replace, keyed by the original product", async () => {
    const u = user();
    render(dialog(editingLine));

    fireEvent.change(screen.getByDisplayValue("2"), { target: { value: "3" } });
    await u.click(screen.getByRole("button", { name: /^save$/i }));

    expect(mocks.replace).toHaveBeenCalledTimes(1);
    expect(mocks.replace.mock.calls[0][0]).toMatchObject({
      productId: "p1",
      body: {
        productId: "p1",
        quantity: 3,
        priceClient: 40,
        fulfillment: "sourced",
        sourceTechId: "t1",
      },
    });
    expect(mocks.add).not.toHaveBeenCalled();
  });

  it("Change item returns to the catalog; the swap takes the new product's price", async () => {
    const u = user();
    render(dialog(editingLine));

    await u.click(screen.getByRole("button", { name: /change item/i }));
    expect(screen.getByPlaceholderText(/search catalog/i)).toBeInTheDocument();

    await u.click(screen.getByText("Schlage Lever"));

    // Configure again, now for the replacement at its own catalog price.
    expect(screen.getByDisplayValue("60")).toBeInTheDocument();

    await u.click(screen.getByRole("button", { name: /^save$/i }));

    expect(mocks.replace).toHaveBeenCalledTimes(1);
    expect(mocks.replace.mock.calls[0][0]).toMatchObject({
      productId: "p1", // the line being replaced
      body: { productId: "p2", priceClient: 60, fulfillment: "sourced" },
    });
  });

  it("counts the quantity already on the line toward availability when editing in place", () => {
    // Van has 1 left, but the line already holds 2 — editing must not flip the
    // line to to-order for any quantity up to 3.
    mocks.stock = new Map([["p1", 1]]);
    render(dialog(editingLine));

    fireEvent.change(screen.getByDisplayValue("2"), { target: { value: "3" } });

    expect(screen.queryByText(/will be added as an item to order/i)).toBeNull();
    expect(screen.getByRole("button", { name: /^save$/i })).toBeInTheDocument();
  });
});

describe("AddProductDialog (imported line)", () => {
  // A Workiz line at $5 against a $45 catalog price: far outside ±15%.
  const importedLine: DealProduct = {
    ...editingLine,
    priceClient: 5,
    fulfillment: "imported",
    sourceTechId: undefined,
  };

  it("does not flag the price and keeps Save enabled", () => {
    render(dialog(importedLine));

    expect(screen.getByDisplayValue("5")).toBeInTheDocument();
    expect(screen.getByText(/the ±15% band doesn.t apply/i)).toBeInTheDocument();
    expect(screen.queryByText(/allowed .* ±15%/i)).toBeNull();
    expect(screen.getByRole("button", { name: /^save$/i })).toBeEnabled();
  });

  it("exempts a service line the importer marked through priceSource", () => {
    render(
      dialog({ ...editingLine, priceClient: 5, fulfillment: "service", priceSource: "imported" }),
    );

    expect(screen.getByText(/the ±15% band doesn.t apply/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^save$/i })).toBeEnabled();
  });

  it("saves the edit — the line stops being imported", async () => {
    const u = user();
    render(dialog(importedLine));

    fireEvent.change(screen.getByDisplayValue("2"), { target: { value: "3" } });
    await u.click(screen.getByRole("button", { name: /^save$/i }));

    expect(mocks.replace).toHaveBeenCalledTimes(1);
    expect(mocks.replace.mock.calls[0][0].body).toMatchObject({
      quantity: 3,
      priceClient: 5,
      fulfillment: "sourced",
    });
  });

  it("re-applies the band as soon as the price itself is edited", () => {
    render(dialog(importedLine));

    // The exemption covers the price Workiz recorded, not a new one typed on
    // top of it — otherwise any imported line is a permanent hole in the rule.
    fireEvent.change(screen.getByDisplayValue("5"), { target: { value: "999" } });

    expect(screen.getByText(/allowed .*±15%/i)).toBeInTheDocument();
    expect(screen.queryByText(/the ±15% band doesn.t apply/i)).toBeNull();
    expect(screen.getByRole("button", { name: /^save$/i })).toBeDisabled();
  });

  it("accepts an edited price that lands inside the band", async () => {
    const u = user();
    render(dialog(importedLine));

    fireEvent.change(screen.getByDisplayValue("5"), { target: { value: "45" } });
    expect(screen.getByRole("button", { name: /^save$/i })).toBeEnabled();

    await u.click(screen.getByRole("button", { name: /^save$/i }));
    expect(mocks.replace.mock.calls[0][0].body).toMatchObject({ priceClient: 45 });
  });

  it("restores the exemption when the imported price is typed back", () => {
    render(dialog(importedLine));

    fireEvent.change(screen.getByDisplayValue("5"), { target: { value: "999" } });
    fireEvent.change(screen.getByDisplayValue("999"), { target: { value: "5" } });

    expect(screen.getByText(/the ±15% band doesn.t apply/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^save$/i })).toBeEnabled();
  });

  it("re-applies the band once the item is swapped for another", async () => {
    const u = user();
    render(dialog(importedLine));

    await u.click(screen.getByRole("button", { name: /change item/i }));
    await u.click(screen.getByText("Schlage Lever"));

    expect(screen.getByText(/allowed .*±15%/i)).toBeInTheDocument();
    fireEvent.change(screen.getByDisplayValue("60"), { target: { value: "5" } });
    expect(screen.getByRole("button", { name: /^save$/i })).toBeDisabled();
  });

  it("still blocks an out-of-band price on a normal line", () => {
    render(dialog({ ...editingLine, priceClient: 5 }));

    expect(screen.getByText(/allowed .*±15%/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^save$/i })).toBeDisabled();
  });
});

describe("AddProductDialog (add mode regression)", () => {
  it("still adds through the add mutation", async () => {
    const u = user();
    render(dialog());

    await u.click(screen.getByText("Schlage Lever"));
    await u.click(screen.getByRole("button", { name: /^add$/i }));

    expect(mocks.add).toHaveBeenCalledTimes(1);
    expect(mocks.add.mock.calls[0][0]).toMatchObject({
      productId: "p2",
      fulfillment: "sourced",
      sourceTechId: "t1",
    });
    expect(mocks.replace).not.toHaveBeenCalled();
  });
});
