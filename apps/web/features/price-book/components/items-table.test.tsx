import { describe, it, expect, vi } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { InventoryStatus, ProductType } from "@bitcrm/types";
import type { Product } from "@bitcrm/types";
import { renderWithClient } from "@/test/render-with-client";
import { ItemsTable } from "./items-table";

// The photo popup has a suite of its own; here only who opens it matters.
vi.mock("@/features/inventory/products/components/product-photo-dialog", () => ({
  ProductPhotoDialog: ({ product }: { product: { id: string } | null }) =>
    product ? <div data-testid="photo-preview" data-id={product.id} /> : null,
}));

function product(over: Partial<Product> = {}): Product {
  return {
    id: "p1",
    number: 1042,
    sku: "LOCK-001",
    name: "Deadbolt",
    category: "Locks",
    type: ProductType.PRODUCT,
    brandId: "b1",
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

const brandNames = new Map([["b1", "Schlage"]]);

function table(items: Product[] = [product()], over: Partial<Parameters<typeof ItemsTable>[0]> = {}) {
  const onOpen = vi.fn();
  const utils = renderWithClient(<ItemsTable items={items} showCost brandNames={brandNames} onOpen={onOpen} {...over} />);
  const firstRow = () => utils.container.querySelector("tbody tr") as HTMLTableRowElement;
  return { ...utils, onOpen, firstRow };
}

describe("ItemsTable — Workiz's grid (pg_pricebook_wz_01_default_scroll1)", () => {
  it("centres every word on the 80px row, as Workiz's flex cells do", () => {
    const { firstRow } = table();
    const cells = [...firstRow().querySelectorAll("td")];
    expect(cells.every((td) => td.className.includes("align-middle"))).toBe(true);
  });

  it("starts Id at 195px and lets every header be dragged", () => {
    const { container } = table();
    expect((container.querySelector("col") as HTMLElement).style.width).toBe("195px");
    expect(container.querySelectorAll("thead [role=separator]").length).toBeGreaterThan(0);
  });

  it("draws Workiz's own picture placeholder beside the number for an item without a photo", () => {
    const { firstRow } = table();
    const id = firstRow().querySelector("td")!;
    expect(id.querySelector("[data-testid=photo-placeholder] svg rect")).toHaveAttribute("fill", "#ECEDEE");
    expect(id).toHaveTextContent("1042");
  });

  it("prints a generated SKU as empty, as Workiz shows a blank Model #", () => {
    const { container } = table([product({ sku: "ITEM-7", skuGenerated: true })]);
    const heads = [...container.querySelectorAll("thead th")].map((th) => th.textContent);
    const cells = [...container.querySelectorAll("tbody tr:first-child td")].map((td) => td.textContent);
    expect(cells[heads.indexOf("Model #")]).toBe("");
  });
});

describe("ItemsTable — what opens what", () => {
  it("opens the item from anywhere on its row", async () => {
    const { onOpen } = table();
    await userEvent.click(screen.getByText("Schlage"));
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: "p1" }), expect.anything());
  });

  it("opens the photo from the picture — not the item", async () => {
    const { onOpen } = table([{ ...product(), photoKey: "k", thumbnailUrl: "https://cdn.test/p1.webp" } as Product]);
    await userEvent.click(screen.getByRole("button", { name: "View photo of Deadbolt" }));
    expect(screen.getByTestId("photo-preview")).toHaveAttribute("data-id", "p1");
    expect(onOpen).not.toHaveBeenCalled();
  });
});
