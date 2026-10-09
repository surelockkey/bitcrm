import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { InventoryStatus, ProductType } from "@bitcrm/types";
import type { Product } from "@bitcrm/types";
import type { ProductMedia } from "../lib";
import { ProductThumb } from "./product-thumb";

function product(over: Partial<Product & ProductMedia> = {}): Product & ProductMedia {
  return {
    id: "p1",
    number: 1042,
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

/** Workiz's picture beside the item's id: 40×40, rounded, a grey picture placeholder without one. */
describe("ProductThumb", () => {
  it("draws the thumbnail lazily, at a fixed 40×40 — nothing moves when it loads", () => {
    render(<ProductThumb product={product({ thumbnailUrl: "https://cdn.test/p1.webp", photoKey: "k" })} onOpen={vi.fn()} />);
    const img = document.querySelector("img") as HTMLImageElement;
    expect(img).toHaveAttribute("src", "https://cdn.test/p1.webp");
    expect(img).toHaveAttribute("loading", "lazy");
    expect(img).toHaveAttribute("decoding", "async");
    expect(img).toHaveAttribute("width", "40");
    expect(img).toHaveAttribute("height", "40");
  });

  it("shows a grey image placeholder for an item without a photo — nothing to open", () => {
    render(<ProductThumb product={product()} onOpen={vi.fn()} />);
    expect(document.querySelector("img")).toBeNull();
    expect(screen.getByTestId("photo-placeholder")).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
  });

  // Workiz: a click on the placeholder does nothing — not the row's Edit popup either.
  it("keeps a click on the placeholder from reaching the row", async () => {
    const onRow = vi.fn();
    render(
      <div onClick={onRow}>
        <ProductThumb product={product()} onOpen={vi.fn()} />
      </div>,
    );
    await userEvent.click(screen.getByTestId("photo-placeholder"));
    expect(onRow).not.toHaveBeenCalled();
  });

  it("is Workiz's box: 40×40, 8px corners, a hairline border, the photo cut to fill it", () => {
    render(<ProductThumb product={product({ thumbnailUrl: "https://cdn.test/p1.webp", photoKey: "k" })} onOpen={vi.fn()} />);
    const box = screen.getByRole("button", { name: "View photo of Deadbolt" });
    expect(box.className).toMatch(/(^|\s)size-10(\s|$)/);
    expect(box.className).toContain("rounded-[8px]");
    // itemImage-module: a .1px #cad3d6 hairline (drawn 1px).
    expect(box.className).toContain("border-wz-rule");
    expect((document.querySelector("img") as HTMLImageElement).className).toMatch(/object-cover/);
  });

  it("falls back to the placeholder when the thumbnail fails to load, still opening the photo", async () => {
    const onOpen = vi.fn();
    render(<ProductThumb product={product({ thumbnailUrl: "https://cdn.test/gone.webp", photoKey: "k" })} onOpen={onOpen} />);
    fireEvent.error(document.querySelector("img") as HTMLImageElement);
    expect(document.querySelector("img")).toBeNull();
    expect(screen.getByTestId("photo-placeholder")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "View photo of Deadbolt" }));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("opens the photo of an item whose thumbnail isn't made yet", async () => {
    const onOpen = vi.fn();
    render(<ProductThumb product={product({ photoKey: "k" })} onOpen={onOpen} />);
    expect(screen.getByTestId("photo-placeholder")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "View photo of Deadbolt" }));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("opens the photo without the click reaching the row (its Edit popup)", async () => {
    const onOpen = vi.fn();
    const onRow = vi.fn();
    render(
      <div onClick={onRow}>
        <ProductThumb product={product({ thumbnailUrl: "https://cdn.test/p1.webp" })} onOpen={onOpen} />
      </div>,
    );
    await userEvent.click(screen.getByRole("button", { name: "View photo of Deadbolt" }));
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onRow).not.toHaveBeenCalled();
  });
});
