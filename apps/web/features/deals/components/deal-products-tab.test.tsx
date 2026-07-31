import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  ClientType,
  DealPriority,
  DealStatus,
  JobSuperStatus,
} from "@bitcrm/types";
import type { Deal, DealProduct } from "@bitcrm/types";

const mocks = vi.hoisted(() => ({
  remove: vi.fn(),
  products: [] as DealProduct[],
  // Every render of the (stubbed) dialog records its props so tests can
  // assert what the tab handed it last.
  dialogProps: [] as Array<{ open: boolean; editing?: DealProduct }>,
}));

vi.mock("../hooks", () => ({
  useDealProducts: () => ({ data: mocks.products, isLoading: false }),
  useRemoveProduct: () => ({ mutate: mocks.remove, isPending: false }),
  useMarkProductOrdered: () => ({ mutate: vi.fn(), isPending: false }),
}));

// The dialog's own behavior is covered in add-product-dialog.test.tsx; here
// only the tab → dialog wiring matters.
vi.mock("./add-product-dialog", () => ({
  AddProductDialog: (props: { open: boolean; editing?: DealProduct }) => {
    mocks.dialogProps.push({ open: props.open, editing: props.editing });
    return props.open ? <div data-testid="product-dialog" /> : null;
  },
}));

import { DealProductsTab } from "./deal-products-tab";

const deal: Deal = {
  id: "d1",
  dealNumber: "1042",
  contactId: "c1",
  clientType: ClientType.RESIDENTIAL,
  serviceArea: "West Valley",
  address: { street: "1 Main", city: "Phoenix", state: "AZ", zip: "85001" },
  jobTypeId: "jt-lockout",
  superStatus: JobSuperStatus.SUBMITTED,
  assignedDispatcherId: "u1",
  priority: DealPriority.NORMAL,
  assignedTechIds: ["t1"],
  tagIds: [],
  status: DealStatus.ACTIVE,
  createdBy: "u1",
  createdAt: "",
  updatedAt: "",
};

const line = (over: Partial<DealProduct> = {}): DealProduct => ({
  productId: "p1",
  name: "Kwikset Deadbolt",
  sku: "KW-1",
  quantity: 2,
  costCompany: 10,
  costForTech: 15,
  priceClient: 45,
  fulfillment: "sourced",
  sourceTechId: "t1",
  addedBy: "u1",
  addedAt: "",
  ...over,
});

const lastDialog = () => mocks.dialogProps[mocks.dialogProps.length - 1];

beforeEach(() => {
  mocks.remove.mockClear();
  mocks.products = [line()];
  mocks.dialogProps.length = 0;
});

describe("DealProductsTab (editable items)", () => {
  it("clicking an item opens the editor for that line", async () => {
    const u = userEvent.setup();
    render(<DealProductsTab deal={deal} canEdit />);

    await u.click(
      screen.getByRole("button", { name: /edit kwikset deadbolt/i }),
    );

    expect(lastDialog().open).toBe(true);
    expect(lastDialog().editing).toMatchObject({ productId: "p1" });
  });

  it("read-only users get no item editor", () => {
    render(<DealProductsTab deal={deal} canEdit={false} />);

    expect(
      screen.queryByRole("button", { name: /edit kwikset deadbolt/i }),
    ).toBeNull();
  });

  it("the remove button removes the line without opening the editor", async () => {
    const u = userEvent.setup();
    render(<DealProductsTab deal={deal} canEdit />);

    await u.click(screen.getByRole("button", { name: /remove kwikset deadbolt/i }));

    expect(mocks.remove).toHaveBeenCalledWith("p1");
    expect(lastDialog().open).toBe(false);
    expect(lastDialog().editing).toBeUndefined();
  });

  it("Add item opens the dialog in add mode (no line attached)", async () => {
    const u = userEvent.setup();
    render(<DealProductsTab deal={deal} canEdit />);

    await u.click(screen.getByRole("button", { name: /add item/i }));

    expect(lastDialog().open).toBe(true);
    expect(lastDialog().editing).toBeUndefined();
  });
});
