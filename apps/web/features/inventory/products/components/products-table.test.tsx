import { describe, it, expect, vi } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { InventoryStatus, ProductType } from "@bitcrm/types";
import type { Product } from "@bitcrm/types";
import { renderWithClient } from "@/test/render-with-client";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ProductsTable, itemColumnWidths } from "./products-table";

// The photo popup has a suite of its own; here only who opens it matters.
vi.mock("./product-photo-dialog", () => ({
  ProductPhotoDialog: ({ product }: { product: { id: string } | null }) =>
    product ? <div data-testid="photo-preview" data-id={product.id} /> : null,
}));

function product(over: Partial<Product> = {}): Product {
  return {
    id: "p1",
    number: 3551,
    sku: "1607-625 (SLK-3551)",
    name: "Don-Jo - Chain Guard - Silver",
    description: "SLK-3551 UPC: 040186243617",
    category: "Door Hardware",
    type: ProductType.PRODUCT,
    costCompany: 20.16,
    costTech: 20.16,
    priceClient: 125,
    serialTracking: false,
    minimumStockLevel: 0,
    onHand: 374,
    brandId: "b-slk",
    customAttributes: { Link_UHS: "https://www.uhs-hardware.com/x" },
    status: InventoryStatus.ACTIVE,
    createdAt: "",
    updatedAt: "",
    ...over,
  };
}

function table(products: Product[] = [product()], over: Partial<Parameters<typeof ProductsTable>[0]> = {}) {
  const onEdit = vi.fn();
  const onStock = vi.fn();
  const utils = renderWithClient(
    <TooltipProvider>
      <ProductsTable
        products={products}
        showCost
        brandNames={new Map([["b-slk", "SLK"]])}
        customFields={["ALL SKU", "Link_UHS"]}
        onEdit={onEdit}
        onStock={onStock}
        {...over}
      />
    </TooltipProvider>,
  );
  // The pinned header (the rows' table repeats the names for a screen reader only).
  const headers = () =>
    [...utils.container.querySelectorAll("[data-slot=wz-report-grid-head] thead th")].map((th) => th.textContent?.trim());
  const cell = (column: string) => {
    const index = headers().indexOf(column);
    return utils.container.querySelectorAll("tbody tr:first-child td")[index] as HTMLElement;
  };
  return { ...utils, onEdit, onStock, headers, cell };
}

/**
 * Workiz's Inventory grid (pg_inventory_wz_01_inventory): Product ID with the
 * picture, Name, Description, Price, Cost, Quantity, SKU, Category, Brand,
 * one column per item custom field, Actions — amounts as "125.00".
 */
describe("ProductsTable — the Workiz columns", () => {
  it("lists Workiz's columns in its order, the custom fields after Brand, Actions last", () => {
    expect(table().headers()).toEqual([
      "Product ID",
      "Name",
      "Description",
      "Price",
      "Cost",
      "Quantity",
      "SKU",
      "Category",
      "Brand",
      "ALL SKU",
      "Link_UHS",
      "Actions",
    ]);
  });

  it("leaves the Cost column out for someone who may not see money", () => {
    expect(table([product()], { showCost: false }).headers()).not.toContain("Cost");
  });

  it("keeps the Cost column while it is not yet known whether money may be shown — its cells wait", () => {
    const { headers, cell } = table([product()], { showCost: "pending" });
    expect(headers()).toContain("Cost");
    expect(cell("Cost").textContent).toBe("");
  });

  it("prints Workiz's amounts and quantity — two decimals, no sign", () => {
    const { cell } = table();
    expect(cell("Price")).toHaveTextContent("125.00");
    expect(cell("Cost")).toHaveTextContent("20.16");
    expect(cell("Quantity")).toHaveTextContent("374.00");
  });

  it("names the brand from the catalog and prints each custom field's value", () => {
    const { cell } = table();
    expect(cell("Brand")).toHaveTextContent("SLK");
    expect(cell("Link_UHS")).toHaveTextContent("https://www.uhs-hardware.com/x");
    expect(cell("ALL SKU")).toHaveTextContent("");
  });

  it("shows the product number beside its picture, Workiz's placeholder without one", () => {
    const { cell } = table();
    expect(cell("Product ID")).toHaveTextContent("3551");
    expect(cell("Product ID").querySelector("[data-testid=photo-placeholder]")).not.toBeNull();
  });

  it("cuts a long word at the cell's edge with an ellipsis, the whole of it on hover", () => {
    const name = table().cell("Name").querySelector("span")!;
    expect(name.className).toContain("truncate");
    expect(name).toHaveAttribute("title", "Don-Jo - Chain Guard - Silver");
  });

  it("opens the photo from the thumbnail — not the item's Edit popup", async () => {
    const { onEdit } = table([product({ thumbnailUrl: "https://cdn.test/p1.webp", photoKey: "k" } as Partial<Product>)]);
    await userEvent.click(screen.getByRole("button", { name: "View photo of Don-Jo - Chain Guard - Silver" }));
    expect(screen.getByTestId("photo-preview")).toHaveAttribute("data-id", "p1");
    expect(onEdit).not.toHaveBeenCalled();
  });

  it("has no checkbox column", () => {
    table();
    expect(screen.queryByRole("checkbox")).toBeNull();
  });
});

describe("ProductsTable — actions", () => {
  it("opens the Edit popup from Workiz's pencil", async () => {
    const { onEdit, onStock } = table();
    await userEvent.click(screen.getByRole("button", { name: "Edit Don-Jo - Chain Guard - Silver" }));
    expect(onEdit).toHaveBeenCalledWith(expect.objectContaining({ id: "p1" }));
    expect(onStock).not.toHaveBeenCalled();
  });

  it("opens Manage stock from Workiz's box", async () => {
    const { onEdit, onStock } = table();
    await userEvent.click(screen.getByRole("button", { name: "Manage stock for Don-Jo - Chain Guard - Silver" }));
    expect(onStock).toHaveBeenCalledWith(expect.objectContaining({ id: "p1" }));
    expect(onEdit).not.toHaveBeenCalled();
  });

  it("opens the Edit popup on a row click", async () => {
    const { onEdit, cell } = table();
    await userEvent.click(cell("Description"));
    expect(onEdit).toHaveBeenCalledWith(expect.objectContaining({ id: "p1" }), expect.anything());
  });

  it("has no row menu — Workiz's Delete Item and Enable item live in the Edit popup", () => {
    table();
    expect(screen.queryByRole("button", { name: "Row actions" })).toBeNull();
  });
});

describe("ProductsTable — the grid's width", () => {
  // Workiz: every column 100px (Actions 130), past the frame the grid scrolls sideways.
  it("starts every column at Workiz's 100px, Product ID wide enough for the number, Actions 130", () => {
    expect(itemColumnWidths(["ALL SKU"], true)).toEqual({
      productId: 150,
      name: 100,
      description: 100,
      price: 100,
      cost: 100,
      quantity: 100,
      sku: 100,
      category: 100,
      brand: 100,
      "field:ALL SKU": 100,
      actions: 130,
    });
    expect(itemColumnWidths([], false)).not.toHaveProperty("cost");
  });

  it("holds the table at the columns' width and scrolls it sideways in its own box", () => {
    table();
    const grid = screen.getByRole("table", { name: "Inventory" });
    // 150 + 8 × 100 + two fields × 100 + 130.
    expect(grid.style.minWidth).toBe("1280px");
    expect(grid.parentElement!.className).toContain("overflow-x-auto");
  });

  it("offers a drag handle on every header", () => {
    table();
    expect(document.querySelectorAll("[data-slot=resize-handle], [role=separator]").length).toBeGreaterThanOrEqual(12);
  });

  it("loading, draws the header over Workiz's loader and no rows", () => {
    table([product()], { loading: true });
    expect(screen.getByRole("status", { name: "Loading" })).toBeInTheDocument();
    expect(screen.queryByText("Don-Jo - Chain Guard - Silver")).toBeNull();
  });
});
