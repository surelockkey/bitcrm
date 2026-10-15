import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
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
  prefetch: vi.fn(),
  prefetchCard: vi.fn(),
  updateDeal: vi.fn(),
  commissionView: true,
  commissionEdit: true,
  setTaxable: vi.fn(),
  setTax: vi.fn(),
  summaryProps: [] as Array<Record<string, unknown>>,
  products: [] as DealProduct[],
  // Every render of the (stubbed) dialog records its props so tests can
  // assert what the tab handed it last.
  dialogProps: [] as Array<{ open: boolean; editing?: DealProduct }>,
  // The job's payment schedule (billing): what usePaymentSchedule answers, and what it was asked.
  schedule: { data: null, isSuccess: true, isError: false, isPending: false, fetchStatus: "idle" } as Record<string, unknown>,
  scheduleAsked: [] as Array<{ dealId: string; enabled: boolean }>,
  payProps: [] as Array<{ open: boolean; target?: string; balanceDue: number; invoiceId: string }>,
  scheduleDialogProps: [] as Array<{ open: boolean; total: number; amountPaid: number; view: unknown }>,
  scheduleTableProps: [] as Array<{ invoiceId?: string; canCollect: boolean; canViewPdf: boolean }>,
  groupDialogProps: [] as Array<{ mode: string; initialLines?: Array<{ productId: string; cost: string }> }>,
}));

vi.mock("@/features/payments/schedule-hooks", () => ({
  usePaymentSchedule: (dealId: string, enabled = true) => {
    mocks.scheduleAsked.push({ dealId, enabled });
    return enabled ? mocks.schedule : { data: undefined, isSuccess: false, isError: false, isPending: true, fetchStatus: "idle" };
  },
  useRefreshScheduleOnTotal: () => {},
}));
// "Pay" opens the job's Record a payment; its own tests cover the form.
vi.mock("@/features/payments/components/record-payment-dialog", () => ({
  RecordPaymentDialog: (p: { open: boolean; target?: string; balanceDue: number; invoiceId: string }) => {
    mocks.payProps.push(p);
    return p.open ? <div role="dialog" aria-label="Record a payment" /> : null;
  },
}));
// The schedule window and table have their own tests (payment-schedule.test.tsx); the button is the real one.
vi.mock("@/features/payments/components/payment-schedule", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/payments/components/payment-schedule")>()),
  PaymentScheduleDialog: (p: { open: boolean; total: number; amountPaid: number; view: unknown }) => {
    mocks.scheduleDialogProps.push(p);
    return p.open ? <div role="dialog" aria-label="Add payment schedule" /> : null;
  },
  PaymentScheduleTable: (p: { invoiceId?: string; canCollect: boolean; canViewPdf: boolean }) => {
    mocks.scheduleTableProps.push(p);
    return <section aria-label="Payment schedule" />;
  },
}));

vi.mock("../hooks", () => ({
  useDealProducts: () => ({ data: mocks.products, isLoading: false }),
  usePrefetchCatalogProduct: () => mocks.prefetch,
  usePrefetchJobItemCard: mocks.prefetchCard,
  useUpdateDeal: () => ({ mutate: mocks.updateDeal, isPending: false }),
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

// Workiz's save-as-group icon opens Create item group (its own tests cover the window).
vi.mock("@/features/price-book/item-groups/item-group-dialog", () => ({
  ItemGroupDialog: (p: { mode: string; initialLines?: Array<{ productId: string; cost: string }>; onClose: () => void }) => {
    mocks.groupDialogProps.push(p);
    return <div role="dialog" aria-label="Create item group" />;
  },
}));

// The Commission rate block: commission.view to see it, commission.edit to change it.
vi.mock("@/features/auth/use-permissions", () => ({
  usePermissions: () => ({
    isTechnician: false,
    isLoading: false,
    can: (resource: string, action?: string) =>
      resource === "commission" ? (action === "edit" ? mocks.commissionEdit : mocks.commissionView) : true,
  }),
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
  mocks.schedule = { data: null, isSuccess: true, isError: false, isPending: false, fetchStatus: "idle" };
  mocks.scheduleAsked.length = 0;
  mocks.updateDeal.mockClear();
  mocks.commissionView = true;
  mocks.commissionEdit = true;
  mocks.payProps.length = 0;
  mocks.scheduleDialogProps.length = 0;
  mocks.scheduleTableProps.length = 0;
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

  it("reads the card's custom fields and the first van's stock ahead, so Add item / Edit open whole", () => {
    render(<DealProductsTab deal={deal} canEdit variant="job" />);
    expect(mocks.prefetchCard).toHaveBeenCalledWith(["t1"]);
  });

  it("hovering a row reads its catalog item ahead, so the editor opens whole", async () => {
    const u = userEvent.setup();
    render(<DealProductsTab deal={deal} canEdit />);

    await u.hover(screen.getByRole("button", { name: /edit kwikset deadbolt/i }));

    expect(mocks.prefetch).toHaveBeenCalledWith("p1");
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

  // Workiz's "Tech expenses" box under Job costing: what the technician paid
  // out of pocket, typed by the office off the receipt — the commissions
  // report's Parts, reimbursed to the technician in his balance.
  it("Tech expenses shows the job's amount and writes a typed one to the job", async () => {
    const u = userEvent.setup();
    render(<DealProductsTab deal={{ ...deal, techCost: 100 }} canEdit variant="job" />);

    const box = screen.getByRole("textbox", { name: "Tech expenses" });
    expect(box).toHaveValue("100.00");
    await u.clear(box);
    await u.type(box, "125{Enter}");

    expect(mocks.updateDeal).toHaveBeenCalledWith({ techCost: 125 }, expect.anything());
  });

  it("an emptied Tech expenses box clears the amount", async () => {
    const u = userEvent.setup();
    render(<DealProductsTab deal={{ ...deal, techCost: 100 }} canEdit variant="job" />);

    await u.clear(screen.getByRole("textbox", { name: "Tech expenses" }));
    await u.tab();

    expect(mocks.updateDeal).toHaveBeenCalledWith({ techCost: null }, expect.anything());
  });

  it("leaving the Tech expenses box unchanged writes nothing", async () => {
    const u = userEvent.setup();
    render(<DealProductsTab deal={{ ...deal, techCost: 100 }} canEdit variant="job" />);

    await u.click(screen.getByRole("textbox", { name: "Tech expenses" }));
    await u.tab();

    expect(mocks.updateDeal).not.toHaveBeenCalled();
  });

  it("read-only users see Tech expenses as a plain box", () => {
    render(<DealProductsTab deal={{ ...deal, techCost: 100 }} canEdit={false} variant="job" />);

    expect(screen.queryByRole("textbox", { name: "Tech expenses" })).toBeNull();
    expect(screen.getByRole("group", { name: "Tech expenses" })).toHaveTextContent("100.00");
  });

  it("Commission rate: with commission.view the block is there, and Update writes the rate to the job", async () => {
    const u = userEvent.setup();
    render(<DealProductsTab deal={deal} canEdit variant="job" />);

    await u.click(screen.getByRole("switch", { name: "Custom Tech Rate" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Custom tech rate" }), { target: { value: "50" } });
    await u.click(screen.getByRole("button", { name: "Update" }));

    expect(mocks.updateDeal).toHaveBeenCalledWith({ useTechSpecialRate: true, techSpecialRate: 50, techSpecialRateUnit: "%" }, expect.anything());
  });

  it("Commission rate: without commission.view there is no block at all", () => {
    mocks.commissionView = false;
    render(<DealProductsTab deal={deal} canEdit variant="job" />);
    expect(screen.queryByRole("heading", { name: "Commission rate" })).toBeNull();
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

  it("offers Workiz's save-as-group icon after Job Items, which opens Create item group on the job's lines", async () => {
    mocks.groupDialogProps.length = 0;
    render(<DealProductsTab deal={deal} canEdit variant="job" showCost canSaveGroup balance={0} />);

    await userEvent.click(screen.getByRole("button", { name: "Save items as an item group" }));

    expect(screen.getByRole("dialog", { name: "Create item group" })).toBeInTheDocument();
    expect(mocks.groupDialogProps.at(-1)).toMatchObject({
      mode: "new",
      initialLines: [expect.objectContaining({ productId: "p1", cost: "10" })],
    });
  });

  it("offers no save-as-group icon without products.create, or on a job without items", () => {
    const { unmount } = render(<DealProductsTab deal={deal} canEdit variant="job" showCost balance={0} />);
    expect(screen.queryByRole("button", { name: "Save items as an item group" })).toBeNull();
    unmount();

    mocks.products = [];
    render(<DealProductsTab deal={deal} canEdit variant="job" showCost canSaveGroup balance={0} />);
    expect(screen.queryByRole("button", { name: "Save items as an item group" })).toBeNull();
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

  // Owner, 2026-10-15: a line may be priced below zero — a credit line comes
  // off the subtotal, tax stays on the taxable lines, nothing is clamped.
  it("a job with one negative line: the row reads -$20.00, the boxes total it", () => {
    mocks.products = [
      line({ quantity: 2, priceClient: 50 }),
      line({ productId: "p2", lineId: "line-2", name: "Credit", quantity: 1, priceClient: -20, costCompany: 0, taxable: false }),
    ];
    render(
      <DealProductsTab deal={{ ...deal, taxRateId: "t1", taxRatePercent: 10 }} canEdit variant="job" showCost balance={0} />,
    );

    const credit = screen.getByRole("button", { name: /edit credit/i }).closest("tr")!;
    expect(within(credit).getAllByText("-$20.00")).toHaveLength(2);
    const box = (label: string) => screen.getByRole("group", { name: label });
    expect(box("Subtotal")).toHaveTextContent("80.00");
    expect(box("Taxable")).toHaveTextContent("100.00");
    expect(box("Tax")).toHaveTextContent("10.00");
    expect(box("Total")).toHaveTextContent("90.00");
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

/**
 * The money under Workiz's job Items totals (job_invoice_route_wz_XYB3JT_items_scroll1,
 * job_b_tab_items_scroll0): Balance bold and #dd380d while owed, "Pay" beside it, and
 * "+ Add payment schedule" closing the right column (greyed when nothing is owed) —
 * or, once the job has one, its schedule under the totals (help centre 38044340324753).
 */
describe("DealProductsTab (job variant — Balance, Pay and the payment schedule)", () => {
  const collector = { canCollect: true, canViewPdf: true, invoiceId: "d1" };
  const lastPay = () => mocks.payProps[mocks.payProps.length - 1];
  const lastScheduleDialog = () => mocks.scheduleDialogProps[mocks.scheduleDialogProps.length - 1];

  it("reds the balance while anything is owed, and Pay records a payment for it on the job", async () => {
    mocks.products = [line({ quantity: 2, priceClient: 50 })];
    render(<DealProductsTab deal={deal} canEdit variant="job" balance={60} payments={collector} />);

    const balance = screen.getByRole("group", { name: "Balance" });
    expect(balance).toHaveTextContent("60.00");
    expect(within(balance).getByText("60.00")).toHaveClass("font-bold", "text-[#dd380d]");
    await userEvent.setup().click(within(balance).getByRole("button", { name: "Pay" }));
    expect(screen.getByRole("dialog", { name: "Record a payment" })).toBeInTheDocument();
    expect(lastPay()).toMatchObject({ open: true, target: "job", balanceDue: 60 });
  });

  it("keeps a settled balance grey and offers no Pay — nor to someone who may not collect", () => {
    const { unmount } = render(<DealProductsTab deal={deal} canEdit variant="job" balance={0} payments={collector} />);
    const balance = screen.getByRole("group", { name: "Balance" });
    expect(within(balance).getByText("0.00")).not.toHaveClass("text-[#dd380d]");
    expect(within(balance).queryByRole("button", { name: "Pay" })).toBeNull();
    unmount();

    render(<DealProductsTab deal={deal} canEdit variant="job" balance={60} payments={{ ...collector, canCollect: false }} />);
    expect(screen.queryByRole("button", { name: "Pay" })).toBeNull();
  });

  it("closes the totals with + Add payment schedule, which opens the schedule window on the job total", async () => {
    mocks.products = [line({ quantity: 2, priceClient: 50 })];
    render(<DealProductsTab deal={deal} canEdit variant="job" balance={60} payments={collector} />);

    const add = screen.getByRole("button", { name: "Add payment schedule" });
    expect(add).toBeEnabled();
    await userEvent.setup().click(add);
    expect(screen.getByRole("dialog", { name: "Add payment schedule" })).toBeInTheDocument();
    expect(lastScheduleDialog()).toMatchObject({ open: true, total: 100, amountPaid: 40, view: null });
    expect(mocks.scheduleAsked.at(-1)).toEqual({ dealId: "d1", enabled: true });
  });

  it("greys + Add payment schedule when nothing is owed (5TU7ZA)", () => {
    render(<DealProductsTab deal={deal} canEdit variant="job" balance={0} payments={collector} />);
    expect(screen.getByRole("button", { name: "Add payment schedule" })).toBeDisabled();
  });

  it("shows the job's schedule under the totals once it has one, instead of the button", () => {
    mocks.schedule = { ...mocks.schedule, data: { dealId: "d1", lines: [] } };
    render(<DealProductsTab deal={deal} canEdit variant="job" balance={60} payments={collector} />);

    expect(screen.getByRole("region", { name: "Payment schedule" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add payment schedule" })).toBeNull();
    expect(mocks.scheduleTableProps.at(-1)).toMatchObject({ invoiceId: "d1", canCollect: true, canViewPdf: true });
  });

  it("shows a schedule read-only to someone who may see payments but not take them", () => {
    mocks.schedule = { ...mocks.schedule, data: { dealId: "d1", lines: [] } };
    render(<DealProductsTab deal={deal} canEdit variant="job" balance={60} payments={{ canCollect: false, canViewPdf: false }} />);
    expect(screen.getByRole("region", { name: "Payment schedule" })).toBeInTheDocument();
    expect(mocks.scheduleTableProps.at(-1)).toMatchObject({ invoiceId: undefined, canCollect: false, canViewPdf: false });

    mocks.schedule = { ...mocks.schedule, data: null };
    render(<DealProductsTab deal={deal} canEdit variant="job" balance={60} payments={{ canCollect: false, canViewPdf: false }} />);
    expect(screen.queryByRole("button", { name: "Add payment schedule" })).toBeNull();
  });

  it("asks nothing about schedules without payments.view", () => {
    render(<DealProductsTab deal={deal} canEdit variant="job" balance={60} />);
    expect(screen.queryByRole("button", { name: "Add payment schedule" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Pay" })).toBeNull();
    expect(mocks.scheduleAsked.every((a) => !a.enabled)).toBe(true);
  });

  it("comes up whole: the tab waits for the schedule rather than pushing it in under the totals", () => {
    mocks.schedule = { data: undefined, isSuccess: false, isError: false, isPending: true, fetchStatus: "fetching" };
    const { container } = render(<DealProductsTab deal={deal} canEdit variant="job" balance={60} payments={collector} />);
    expect(screen.queryByRole("heading", { name: "Job Items" })).toBeNull();
    expect(container.querySelector("[data-slot=skeleton]")).not.toBeNull();
  });
});
