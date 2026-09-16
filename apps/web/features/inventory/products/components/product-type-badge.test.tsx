import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { InventoryStatus, ProductType } from "@bitcrm/types";
import type { Product } from "@bitcrm/types";
import { ProductTypeBadge } from "./product-type-badge";

const product = (over: Partial<Product>): Product => ({
  id: "p1",
  sku: "KW-1",
  name: "Deadbolt",
  category: "Locks",
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

describe("ProductTypeBadge", () => {
  it("shows the BitCRM type", () => {
    render(<ProductTypeBadge product={product({})} />);
    expect(screen.getByText("Product")).toBeInTheDocument();
    expect(screen.queryByText("other")).toBeNull();
  });

  it("keeps the Workiz type alongside the service pill", () => {
    // Workiz `other` / `hours` items import as services; the original word is
    // preserved so the price book still reads the way it did in Workiz.
    render(
      <ProductTypeBadge
        product={product({ type: ProductType.SERVICE, workizType: "other" })}
      />,
    );

    expect(screen.getByText("Service")).toBeInTheDocument();
    expect(screen.getByText("other")).toBeInTheDocument();
  });

  it("still shows the serial-tracking marker", () => {
    render(<ProductTypeBadge product={product({ serialTracking: true })} />);
    expect(screen.getByText("serial")).toBeInTheDocument();
  });
});
