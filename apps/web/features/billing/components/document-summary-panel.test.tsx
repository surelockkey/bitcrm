import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
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
