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
  DiscountEditor: () => <div data-testid="discount-editor" />,
}));

// The tax picker reads the catalog through react-query; a plain stand-in here.
vi.mock("@/features/billing/components/tax-rate-select", () => ({
  TaxRateSelect: ({ "aria-label": label }: { "aria-label"?: string }) => <select aria-label={label ?? "Tax rate"} />,
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
  lineId: "line-1",
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

    // The line is addressed by its own id, not by the product it names.
    expect(mocks.remove).toHaveBeenCalledWith("line-1");
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

    expect(mocks.setTaxable).toHaveBeenCalledWith({ lineId: "line-1", taxable: false });
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

/**
 * The job page's own Items tab, dressed as Workiz's (job_b_tab_items): a
 * "Job Items" heading, a ruled grid Item / Quantity / Price / Cost / Amount /
 * Taxable, "Add items" when empty, and the totals as two columns of small
 * grey boxes. The invoice keeps the shared layout.
 */
describe("DealProductsTab (job variant — Workiz's Items tab)", () => {
  it("heads the grid like Workiz, Cost only for those who see money", () => {
    const { unmount } = render(<DealProductsTab deal={deal} canEdit variant="job" showCost balance={0} />);

    expect(screen.getByRole("heading", { name: "Job Items" })).toBeInTheDocument();
    expect(screen.getAllByRole("columnheader").map((h) => h.textContent)).toEqual([
      "Item",
      "Quantity",
      "Price",
      "Cost",
      "Amount",
      "Taxable",
      "Actions",
    ]);
    unmount();

    render(<DealProductsTab deal={deal} canEdit={false} variant="job" showCost={false} balance={0} />);
    expect(screen.getAllByRole("columnheader").map((h) => h.textContent)).toEqual([
      "Item",
      "Quantity",
      "Price",
      "Amount",
      "Taxable",
    ]);
  });

  it("fills a row as Workiz does: 2.00, $45.00, $10.00, $90.00", () => {
    render(<DealProductsTab deal={deal} canEdit variant="job" showCost balance={0} />);

    const row = screen.getByRole("button", { name: /edit kwikset deadbolt/i }).closest("tr")!;
    expect(row).toHaveTextContent("2.00");
    expect(row).toHaveTextContent("$45.00");
    expect(row).toHaveTextContent("$10.00");
    expect(row).toHaveTextContent("$90.00");
  });

  // audit_pixels T2: Workiz's 85px row holds the name and the type chip only,
  // and Taxable is a word ("No"), edited in the item's own window.
  it("reads Taxable as Workiz's Yes / No, and keeps the description and SKU in the name's tooltip", () => {
    mocks.products = [
      line({ description: "Front door, brushed nickel", sku: "KW-1", costForTech: 12 }),
      line({ productId: "p2", lineId: "line-2", name: "Rekey", taxable: false }),
    ];
    render(<DealProductsTab deal={deal} canEdit variant="job" showCost balance={0} />);

    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    const first = screen.getByRole("button", { name: /edit kwikset deadbolt/i });
    const rekey = screen.getByRole("button", { name: /edit rekey/i }).closest("tr")!;
    expect(first.closest("tr")!.lastElementChild?.previousElementSibling).toHaveTextContent(/^Yes$/);
    expect(rekey.lastElementChild?.previousElementSibling).toHaveTextContent(/^No$/);
    expect(screen.queryByText("Front door, brushed nickel")).not.toBeInTheDocument();
    expect(screen.queryByText(/KW-1 · tech/)).not.toBeInTheDocument();
    expect(first).toHaveAttribute("title", "Front door, brushed nickel\nKW-1 · tech $12.00");
  });

  it("invites 'Add items' on an empty job, which opens the add dialog", async () => {
    const u = userEvent.setup();
    mocks.products = [];
    render(<DealProductsTab deal={deal} canEdit variant="job" showCost balance={0} />);

    await u.click(screen.getByRole("button", { name: "Add items" }));
    expect(lastDialog().open).toBe(true);
    expect(lastDialog().editing).toBeUndefined();
  });

  it("totals in boxes: Total and Balance on the left, Subtotal → Tax on the right", () => {
    mocks.products = [line({ quantity: 2, priceClient: 50 })];
    render(
      <DealProductsTab
        deal={{ ...deal, taxRateId: "t1", taxRatePercent: 10, discount: { type: "amount", value: 20 } }}
        canEdit
        variant="job"
        showCost
        balance={38}
      />,
    );

    const box = (label: string) => screen.getByRole("group", { name: label });
    expect(box("Total")).toHaveTextContent("88.00");
    expect(box("Balance")).toHaveTextContent("38.00");
    expect(box("Subtotal")).toHaveTextContent("100.00");
    expect(box("Discount")).toHaveTextContent("20.00");
    expect(box("Taxable")).toHaveTextContent("80.00");
    expect(box("Tax")).toHaveTextContent("8.00");
    // No shared summary card on the job page.
    expect(screen.queryByTestId("summary")).toBeNull();
  });
});
