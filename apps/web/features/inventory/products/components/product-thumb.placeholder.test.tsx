import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { InventoryStatus, ProductType } from "@bitcrm/types";
import { ProductThumb } from "./product-thumb";

const product = {
  id: "p1",
  sku: "S",
  name: "Deadbolt",
  category: "Locks",
  type: ProductType.PRODUCT,
  costCompany: 0,
  costTech: 0,
  priceClient: 0,
  serialTracking: false,
  minimumStockLevel: 0,
  status: InventoryStatus.ACTIVE,
  createdAt: "",
  updatedAt: "",
};

/** The Price Book draws Workiz's own placeholder; Inventory keeps its icon until its page asks too. */
describe("ProductThumb placeholder", () => {
  it("draws the caller's placeholder in the frame when there is no photo", () => {
    render(<ProductThumb product={product} onOpen={vi.fn()} placeholder={<span data-testid="wz-ph" />} />);
    expect(screen.getByTestId("photo-placeholder")).toContainElement(screen.getByTestId("wz-ph"));
  });

  it("keeps its own icon without one (unchanged default)", () => {
    render(<ProductThumb product={product} onOpen={vi.fn()} />);
    expect(screen.queryByTestId("wz-ph")).toBeNull();
    expect(screen.getByTestId("photo-placeholder").querySelector("svg")).not.toBeNull();
  });
});
