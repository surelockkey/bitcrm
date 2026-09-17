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
  setTaxable: vi.fn(),
  setTax: vi.fn(),
  summaryProps: [] as Array<Record<string, unknown>>,
  products: [] as DealProduct[],
  // Every render of the (stubbed) dialog records its props so tests can
  // assert what the tab handed it last.
  dialogProps: [] as Array<{ open: boolean; editing?: DealProduct }>,
}));

vi.mock("../hooks", () => ({
  useDealProducts: () => ({ data: mocks.products, isLoading: false }),
  useRemoveProduct: () => ({ mutate: mocks.remove, isPending: false }),
  useMarkProductOrdered: () => ({ mutate: vi.fn(), isPending: false }),
  useDealTotals: () => ({ data: undefined, isFetching: false }),
  useSetProductTaxable: () => ({ mutate: mocks.setTaxable, isPending: false }),
  useSetDealTax: () => ({ mutate: mocks.setTax, isPending: false }),
  useResetDealTax: () => ({ mutate: vi.fn(), isPending: false }),
  useSetDealDiscount: () => ({ mutate: vi.fn(), isPending: false }),
}));

vi.mock("@/features/clients/hooks", () => ({
  useContact: () => ({ data: undefined }),
}));

// The panel is covered on its own; here only the tab → panel wiring matters.
vi.mock("@/features/billing/components/document-summary-panel", () => ({
  DocumentSummaryPanel: (props: Record<string, unknown>) => {
    mocks.summaryProps.push(props);
    return <div data-testid="summary" />;
  },
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
  mocks.setTaxable.mockClear();
  mocks.setTax.mockClear();
  mocks.summaryProps.length = 0;
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

describe("DealProductsTab (taxes)", () => {
  const lastSummary = () => mocks.summaryProps[mocks.summaryProps.length - 1];

  it("unticking Taxable flips the line without opening the editor", async () => {
    const u = userEvent.setup();
    render(<DealProductsTab deal={deal} canEdit />);

    const box = screen.getByRole("checkbox", { name: /kwikset deadbolt is taxable/i });
    expect(box).toBeChecked();
    await u.click(box);

    expect(mocks.setTaxable).toHaveBeenCalledWith({ productId: "p1", taxable: false });
    expect(lastDialog().open).toBe(false);
  });

  it("a line without the flag reads as taxable; read-only users can't toggle it", () => {
    mocks.products = [line({ taxable: undefined }), line({ productId: "p2", name: "Rekey", taxable: false })];
    render(<DealProductsTab deal={deal} canEdit={false} />);

    expect(screen.getByRole("checkbox", { name: /kwikset deadbolt is taxable/i })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: /kwikset deadbolt is taxable/i })).toBeDisabled();
    expect(screen.getByRole("checkbox", { name: /rekey is taxable/i })).not.toBeChecked();
  });

  it("shows the line description under the name", () => {
    mocks.products = [line({ description: "Front door, brushed nickel" })];
    render(<DealProductsTab deal={deal} canEdit />);

    expect(screen.getByText("Front door, brushed nickel")).toBeInTheDocument();
  });

  it("falls back to local totals (tax on taxable lines only, after discount) until the server answers", () => {
    mocks.products = [line({ quantity: 2, priceClient: 50 }), line({ productId: "p2", priceClient: 100, quantity: 1, taxable: false })];
    render(
      <DealProductsTab
        deal={{ ...deal, taxRateId: "t1", taxRatePercent: 10, taxSource: "service_area", discount: { type: "amount", value: 20 } }}
        canEdit
      />,
    );

    const props = lastSummary();
    expect(props.totals).toMatchObject({ subtotal: 200, discount: 20, tax: 9, total: 189 });
    expect(props).toMatchObject({ taxRateId: "t1", taxSource: "service_area", canEdit: true });

    (props.onTaxChange as (id: string | null) => void)(null);
    expect(mocks.setTax).toHaveBeenCalledWith(null);
  });

  it("flags a tax-exempt job", () => {
    render(<DealProductsTab deal={{ ...deal, taxSource: "exempt" }} canEdit />);

    expect(screen.getByText(/tax exempt/i)).toBeInTheDocument();
  });
});

describe("DealProductsTab (imported lines)", () => {
  it("badges a line the importer wrote and keeps it editable", async () => {
    const u = userEvent.setup();
    mocks.products = [line({ fulfillment: "imported", sourceTechId: undefined })];
    render(<DealProductsTab deal={deal} canEdit />);

    expect(screen.getByText("Imported")).toBeInTheDocument();

    await u.click(screen.getByRole("button", { name: /edit kwikset deadbolt/i }));
    expect(lastDialog().editing).toMatchObject({ fulfillment: "imported" });
  });

  it("offers no 'Mark ordered' action on an imported line", () => {
    mocks.products = [line({ fulfillment: "imported", sourceTechId: undefined })];
    render(<DealProductsTab deal={deal} canEdit />);

    expect(screen.queryByRole("button", { name: /mark ordered/i })).toBeNull();
  });

  it("totals imported lines like any other", () => {
    mocks.products = [
      line({ fulfillment: "imported", quantity: 2, priceClient: 5 }),
      line({ productId: "p2", name: "Labor", quantity: 1, priceClient: 90 }),
    ];
    render(<DealProductsTab deal={deal} canEdit />);

    expect(mocks.summaryProps[mocks.summaryProps.length - 1].totals).toMatchObject({ subtotal: 100, total: 100 });
  });
});
