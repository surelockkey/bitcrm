import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { calculateDocumentTotals } from "@bitcrm/types";
import type { TaxRate } from "@bitcrm/types";
import { TooltipProvider } from "@/components/ui/tooltip";

const rates: TaxRate[] = [
  {
    id: "t1",
    name: "State",
    ratePercent: 6.35,
    isDefault: false,
    active: true,
    serviceAreaId: "t1",
    serviceAreaName: "Hartford",
    isGroup: false,
    componentIds: [],
    createdBy: "u",
    createdAt: "",
    updatedAt: "",
  },
];

vi.mock("@/features/tax-rates/hooks", () => ({
  useActiveTaxRates: () => ({ active: rates, isLoading: false, isError: false }),
}));

import { DocumentSummaryPanel, type DocumentSummaryPanelProps } from "./document-summary-panel";

const totals = calculateDocumentTotals({
  lines: [{ quantity: 1, priceClient: 100 }],
  taxRatePercent: 6.35,
  discount: { type: "percent", value: 10 },
  amountPaid: 50,
});

function setup(over: Partial<DocumentSummaryPanelProps> = {}) {
  const props: DocumentSummaryPanelProps = {
    totals,
    taxRateId: "t1",
    taxRateName: "State",
    taxSource: "manual",
    discount: { type: "percent", value: 10 },
    canEdit: true,
    onTaxChange: vi.fn(),
    onResetTaxAuto: vi.fn(),
    onDiscountChange: vi.fn(),
    ...over,
  };
  render(
    <TooltipProvider>
      <DocumentSummaryPanel {...props} />
    </TooltipProvider>,
  );
  return props;
}

describe("DocumentSummaryPanel", () => {
  it("renders subtotal, discount, tax and total from the given totals", () => {
    setup();
    expect(screen.getByText("Subtotal").nextSibling).toHaveTextContent("$100.00");
    expect(screen.getByText("Discount (10%)")).toBeInTheDocument();
    expect(screen.getByText("−$10.00")).toBeInTheDocument();
    expect(screen.getByText("$5.72")).toBeInTheDocument(); // 6.35% of 90
    expect(screen.getByText("Total").nextSibling).toHaveTextContent("$95.72");
    expect(screen.queryByText("Balance due")).toBeNull();
  });

  it("shows Paid / Balance due only when asked", () => {
    setup({ showPayments: true });
    expect(screen.getByText("Balance due").nextSibling).toHaveTextContent("$45.72");
    expect(screen.queryByText("Clearing")).toBeNull();
  });

  it("adds a clearing line while a bank payment is in flight", () => {
    setup({
      showPayments: true,
      paymentSummary: { settled: 50, pending: 20, refunded: 0, paymentCount: 2, hasPending: true },
    });
    expect(screen.getByText("Clearing").nextSibling).toHaveTextContent("$20.00");
    expect(screen.getByText(/not counted until it lands/i)).toBeInTheDocument();
  });

  it("keeps the ledger out of the way when nothing is clearing", () => {
    setup({
      showPayments: true,
      paymentSummary: { settled: 50, pending: 0, refunded: 0, paymentCount: 1, hasPending: false },
    });
    expect(screen.queryByText("Clearing")).toBeNull();
  });

  it("removes the discount", async () => {
    const u = userEvent.setup();
    const props = setup();
    await u.click(screen.getByRole("button", { name: /remove discount/i }));
    expect(props.onDiscountChange).toHaveBeenCalledWith(null);
  });

  it("adds a dollar discount through the inline editor", async () => {
    const u = userEvent.setup();
    const props = setup({ discount: undefined });
    await u.click(screen.getByRole("button", { name: /add discount/i }));
    await u.type(screen.getByRole("spinbutton", { name: /discount amount/i }), "12.5");
    await u.click(screen.getByRole("button", { name: /apply/i }));
    expect(props.onDiscountChange).toHaveBeenCalledWith({ type: "amount", value: 12.5 });
  });

  it("switches the editor to percent", async () => {
    const u = userEvent.setup();
    const props = setup({ discount: undefined });
    await u.click(screen.getByRole("button", { name: /add discount/i }));
    await u.click(screen.getByRole("radio", { name: /percent/i }));
    await u.type(screen.getByRole("spinbutton", { name: /discount percent/i }), "15");
    await u.keyboard("{Enter}");
    expect(props.onDiscountChange).toHaveBeenCalledWith({ type: "percent", value: 15 });
  });

  it("offers reset-to-automatic only for a manual tax", async () => {
    const u = userEvent.setup();
    const props = setup();
    await u.click(screen.getByRole("button", { name: /reset tax to automatic/i }));
    expect(props.onResetTaxAuto).toHaveBeenCalled();
  });

  it("marks automatic tax with an Auto badge and hides reset", () => {
    setup({ taxSource: "service_area" });
    expect(screen.getByText("Auto")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /reset tax to automatic/i })).toBeNull();
  });

  it("read-only: no editors, shows the rate name", () => {
    setup({ canEdit: false });
    expect(screen.queryByRole("combobox", { name: /tax rate/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /remove discount/i })).toBeNull();
    expect(screen.getByText("State 6.35%")).toBeInTheDocument();
  });

  it("labels picker options with the owning service area, plus No tax", async () => {
    const u = userEvent.setup();
    setup({ taxRateId: undefined });
    await u.click(screen.getByRole("combobox", { name: /tax rate/i }));
    expect(await screen.findByRole("option", { name: "State 6.35% · Hartford" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "No tax" })).toBeInTheDocument();
  });

  it("shows the exempt badge for an exempt client", () => {
    setup({ taxSource: "exempt", taxRateId: undefined });
    expect(screen.getByText("Exempt")).toBeInTheDocument();
  });
});

/** Workiz's totals under a document's items (pg_estimate_wz_01_job): labels and grey boxes, Total on the left. */
describe("DocumentSummaryPanel — variant workiz", () => {
  const box = (label: string) => screen.getByRole("group", { name: label });

  it("puts Total on the left and Subtotal → Discount → Taxable → Tax rate% → Tax on the right, amounts without $", () => {
    setup({ variant: "workiz" });
    const [left, right] = screen.getAllByTestId("wz-totals-column");
    expect(within(left).getByRole("group", { name: "Total" })).toHaveTextContent("Total :95.72");
    expect(within(right).getAllByRole("group").map((g) => g.getAttribute("aria-label"))).toEqual([
      "Subtotal",
      "Discount",
      "Taxable",
      "Tax rate",
      "Tax",
    ]);
    expect(box("Subtotal")).toHaveTextContent("Subtotal :100.00");
    expect(box("Discount")).toHaveTextContent("Discount:10.00");
    expect(box("Taxable")).toHaveTextContent("Taxable :90.00");
    expect(box("Tax")).toHaveTextContent("Tax :5.72");
    expect(screen.queryByText("Balance due")).toBeNull();
  });

  it("opens the discount editor from the Discount box", async () => {
    const u = userEvent.setup();
    const props = setup({ variant: "workiz", discount: undefined });
    await u.click(within(box("Discount")).getByRole("button"));
    await u.type(screen.getByRole("spinbutton", { name: /discount amount/i }), "12.5");
    await u.click(screen.getByRole("button", { name: /apply/i }));
    expect(props.onDiscountChange).toHaveBeenCalledWith({ type: "amount", value: 12.5 });
  });

  it("picks the tax rate in the Tax rate% row; a reader sees the rate's words", () => {
    setup({ variant: "workiz" });
    expect(screen.getByRole("combobox", { name: /tax rate/i })).toBeInTheDocument();
  });

  it("read-only: words in the boxes, no editors", () => {
    setup({ variant: "workiz", canEdit: false });
    expect(screen.queryByRole("combobox", { name: /tax rate/i })).toBeNull();
    expect(within(box("Discount")).queryByRole("button")).toBeNull();
    expect(box("Tax rate")).toHaveTextContent("State (6.35%)");
  });

  it("adds the document's own rows (an estimate's Item cost / Deposit) at the foot of the right column", () => {
    setup({ variant: "workiz", extraRows: <div role="group" aria-label="Deposit">Deposit :</div> });
    const right = screen.getAllByTestId("wz-totals-column")[1];
    expect(within(right).getAllByRole("group").at(-1)).toHaveAttribute("aria-label", "Deposit");
  });

  it("an invoice adds Paid and Balance due under Total", () => {
    setup({ variant: "workiz", showPayments: true });
    const left = screen.getAllByTestId("wz-totals-column")[0];
    expect(within(left).getByRole("group", { name: "Paid" })).toHaveTextContent("50.00");
    expect(within(left).getByRole("group", { name: "Balance due" })).toHaveTextContent("45.72");
  });
});
