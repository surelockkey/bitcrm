import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { InventoryStatus, ProductType } from "@bitcrm/types";
import type { Product } from "@bitcrm/types";
import { renderWithClient } from "@/test/render-with-client";

const mocks = vi.hoisted(() => ({
  denied: new Set<string>(),
  archive: vi.fn(),
  reactivate: vi.fn(),
}));

vi.mock("@/features/auth/use-permissions", () => ({
  useDenied: () => () => false,
  usePermissions: () => ({
    can: (resource: string, action = "view") => !mocks.denied.has(`${resource}.${action}`),
  }),
}));
vi.mock("../hooks", () => ({
  useArchiveProduct: () => ({ mutate: mocks.archive, isPending: false }),
  useReactivateProduct: () => ({ mutate: mocks.reactivate, isPending: false }),
}));

import { ProductRowActions } from "./product-row-actions";

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

const archived = () => product({ status: InventoryStatus.ARCHIVED });
const kebab = () => screen.queryByRole("button", { name: "Row actions" });

beforeEach(() => {
  mocks.denied = new Set();
  mocks.archive.mockReset();
  mocks.reactivate.mockReset();
});

describe("ProductRowActions — who gets the kebab", () => {
  it("archiving an active item takes products.delete, not products.edit", () => {
    mocks.denied.add("products.edit");
    const { unmount } = renderWithClient(<ProductRowActions product={product()} />);
    expect(kebab()).toBeInTheDocument();
    unmount();

    mocks.denied = new Set(["products.delete"]);
    renderWithClient(<ProductRowActions product={product()} />);
    expect(kebab()).toBeNull();
  });

  it("restoring an archived item takes products.edit, not products.delete", () => {
    mocks.denied.add("products.delete");
    const { unmount } = renderWithClient(<ProductRowActions product={archived()} />);
    expect(kebab()).toBeInTheDocument();
    unmount();

    mocks.denied = new Set(["products.edit"]);
    renderWithClient(<ProductRowActions product={archived()} />);
    expect(kebab()).toBeNull();
  });
});

describe("ProductRowActions — what the menu does", () => {
  it("archives this item once the confirmation is accepted", async () => {
    renderWithClient(<ProductRowActions product={product()} />);
    await userEvent.click(kebab()!);
    await userEvent.click(await screen.findByRole("menuitem", { name: "Archive" }));
    expect(screen.getByRole("alertdialog", { name: "Archive “Deadbolt”?" })).toBeInTheDocument();
    expect(mocks.archive).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: "Archive" }));
    expect(mocks.archive).toHaveBeenCalledWith("p1");
  });

  it("does not archive when the confirmation is cancelled", async () => {
    renderWithClient(<ProductRowActions product={product()} />);
    await userEvent.click(kebab()!);
    await userEvent.click(await screen.findByRole("menuitem", { name: "Archive" }));
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(mocks.archive).not.toHaveBeenCalled();
  });

  it("restores an archived item straight from the menu", async () => {
    renderWithClient(<ProductRowActions product={archived()} />);
    await userEvent.click(kebab()!);
    await userEvent.click(await screen.findByRole("menuitem", { name: "Restore" }));
    expect(mocks.reactivate).toHaveBeenCalledWith("p1");
    expect(mocks.archive).not.toHaveBeenCalled();
  });
});
