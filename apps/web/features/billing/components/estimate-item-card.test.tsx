import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { InventoryStatus, ProductType } from "@bitcrm/types";
import type { ItemAttribute, Product } from "@bitcrm/types";
import { Dialog } from "@/components/ui/dialog";
import { WzDialogContent } from "@/features/inventory/item-edit/wz";
import { EstimateItemCard, type EstimateItemCardProps } from "./estimate-item-card";
import type { PickerLine } from "./product-picker-dialog";

const product = (over: Partial<Product> = {}): Product => ({
  id: "p1",
  sku: "SVC-TRIP",
  name: "Service Trip Charge",
  category: "services",
  type: ProductType.SERVICE,
  costCompany: 0,
  costTech: 5,
  priceClient: 45,
  serialTracking: false,
  minimumStockLevel: 0,
  status: InventoryStatus.ACTIVE,
  createdAt: "",
  updatedAt: "",
  taxable: false,
  customAttributes: { Link_UHS: "https://uhs/x" },
  ...over,
});

const attribute = (name: string): ItemAttribute => ({
  id: `attr-${name}`,
  name,
  type: "text",
  visible: false,
  resource: "items",
});

const line = (over: Partial<PickerLine> = {}): PickerLine => ({
  productId: "p1",
  productType: ProductType.SERVICE,
  name: "Service Trip Charge",
  sku: "SVC-TRIP",
  description: "Standard trip charge covering travel time and arrival at the service location.",
  quantity: 1,
  priceClient: 45,
  costCompany: 0,
  costForTech: 7,
  taxable: false,
  soldBy: "u1",
  customAttributes: { SKU_CRM: "CRM-1" },
  optional: true,
  ...over,
});

const user = () => userEvent.setup({ pointerEventsCheck: 0 });

function renderCard(over: Partial<EstimateItemCardProps> = {}) {
  const props: EstimateItemCardProps = {
    product: product(),
    mayCost: true,
    users: [
      { id: "u1", firstName: "Ann", lastName: "Seller" },
      { id: "u2", firstName: "Carl", lastName: "Sales" },
    ],
    fields: [attribute("ALL SKU"), attribute("Link_UHS"), attribute("SKU_CRM")],
    pending: false,
    onSave: vi.fn(),
    onClose: vi.fn(),
    ...over,
  };
  render(
    <Dialog open onOpenChange={() => {}}>
      <WzDialogContent>
        <EstimateItemCard {...props} />
      </WzDialogContent>
    </Dialog>,
  );
  return props;
}

describe("EstimateItemCard — Workiz's estimate item card (the job's card, for an estimate)", () => {
  it("adds with Workiz's fields: name, qty · price · markup · cost, description, Sold by, Taxable, Optional, custom fields — no van", () => {
    renderCard();
    expect(screen.getByText("Add estimate items")).toBeInTheDocument();
    expect(screen.getByLabelText("Item Name")).toHaveValue("Service Trip Charge");
    expect(screen.getByLabelText("Quantity")).toHaveValue(1);
    expect(screen.getByLabelText("Price")).toHaveValue(45);
    expect(screen.getByLabelText("Markup")).toBeInTheDocument();
    expect(screen.getByLabelText("Cost")).toHaveValue(0);
    expect(screen.getByPlaceholderText("Description")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Sold by" })).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Taxable Item" })).toHaveAttribute("aria-checked", "false");
    expect(screen.getByRole("switch", { name: "Optional Item" })).toHaveAttribute("aria-checked", "false");
    expect(screen.getByLabelText("Link_UHS")).toHaveValue("https://uhs/x");
    expect(screen.getByLabelText("ALL SKU")).toHaveValue("");
    // An estimate reserves nothing: there is no van to take it from.
    expect(screen.queryByRole("combobox", { name: "Inventory location" })).toBeNull();
  });

  it("saves the estimate line as the card holds it, Optional and Sold by included", async () => {
    const u = user();
    const { onSave } = renderCard();

    fireEvent.change(screen.getByLabelText("Item Name"), { target: { value: "Trip charge (after hours)" } });
    fireEvent.change(screen.getByLabelText("Quantity"), { target: { value: "2" } });
    fireEvent.change(screen.getByLabelText("Price"), { target: { value: "60" } });
    fireEvent.change(screen.getByLabelText("Cost"), { target: { value: "10" } });
    fireEvent.change(screen.getByPlaceholderText("Description"), { target: { value: "Night visit" } });
    await u.click(screen.getByRole("combobox", { name: "Sold by" }));
    await u.click(screen.getByRole("option", { name: "Carl Sales" }));
    await u.click(screen.getByRole("switch", { name: "Taxable Item" }));
    await u.click(screen.getByRole("switch", { name: "Optional Item" }));
    await u.type(screen.getByLabelText("SKU_CRM"), "CRM-9");
    await u.click(screen.getByRole("button", { name: "Save" }));

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith({
      productId: "p1",
      productType: ProductType.SERVICE,
      name: "Trip charge (after hours)",
      sku: "SVC-TRIP",
      description: "Night visit",
      quantity: 2,
      priceClient: 60,
      costCompany: 10,
      costForTech: 5,
      taxable: true,
      soldBy: "u2",
      customAttributes: { Link_UHS: "https://uhs/x", SKU_CRM: "CRM-9" },
      optional: true,
    });
  });

  it("a new line leaves Sold by and Optional off unless they are set", async () => {
    const u = user();
    const { onSave } = renderCard();
    await u.click(screen.getByRole("button", { name: "Save" }));
    const body = (onSave as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(body.soldBy).toBeUndefined();
    expect(body.optional).toBe(false);
  });

  it("an edit opens on the line — Workiz's \"Edit estimate items\" — and offers Change item", async () => {
    const u = user();
    const onChangeItem = vi.fn();
    renderCard({ line: line(), onChangeItem });

    expect(screen.getByText("Edit estimate items")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Description")).toHaveValue(
      "Standard trip charge covering travel time and arrival at the service location.",
    );
    expect(screen.getByRole("combobox", { name: "Sold by" })).toHaveTextContent("Ann Seller");
    expect(screen.getByRole("switch", { name: "Optional Item" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByLabelText("SKU_CRM")).toHaveValue("CRM-1");
    // The line's own values, not the catalog's.
    expect(screen.getByLabelText("Link_UHS")).toHaveValue("");
    await u.click(screen.getByRole("button", { name: "Change item" }));
    expect(onChangeItem).toHaveBeenCalled();
  });

  it("an edit keeps the line's own cost for tech, and Sold by None clears it", async () => {
    const u = user();
    const { onSave } = renderCard({ line: line() });
    await u.click(screen.getByRole("combobox", { name: "Sold by" }));
    await u.click(screen.getByRole("option", { name: "None" }));
    await u.click(screen.getByRole("switch", { name: "Optional Item" }));
    await u.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ soldBy: "", optional: false, costForTech: 7, costCompany: 0 }),
    );
  });

  it("without financials.view: no Cost or Markup, and the line keeps its own cost", async () => {
    const u = user();
    const { onSave } = renderCard({ mayCost: false, line: line({ costCompany: 12 }) });
    expect(screen.queryByLabelText("Cost")).toBeNull();
    expect(screen.queryByLabelText("Markup")).toBeNull();
    await u.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ costCompany: 12 }));
  });

  it("a line whose item left the catalog opens on the line, says so, and saves under the line's item", async () => {
    const u = user();
    const { onSave } = renderCard({ product: null, line: line({ productId: "gone", sku: "OLD-1" }) });
    expect(screen.getByText(/no longer in the catalog/i)).toBeInTheDocument();
    await u.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ productId: "gone", sku: "OLD-1", productType: ProductType.SERVICE }),
    );
  });

  it("takes any price, below zero too", async () => {
    const u = user();
    const { onSave } = renderCard({ mayCost: false });
    fireEvent.change(screen.getByLabelText("Price"), { target: { value: "-20" } });
    await u.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ priceClient: -20 }));
  });

  it("Close closes without saving", async () => {
    const u = user();
    const { onSave, onClose } = renderCard();
    await u.click(screen.getAllByRole("button", { name: "Close" }).at(-1)!);
    expect(onClose).toHaveBeenCalled();
    expect(onSave).not.toHaveBeenCalled();
  });
});
