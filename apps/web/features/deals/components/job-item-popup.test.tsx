import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { InventoryStatus, ProductType } from "@bitcrm/types";
import type { ItemAttribute, Product } from "@bitcrm/types";

const mocks = vi.hoisted(() => ({
  attributes: [] as ItemAttribute[],
}));

import { Dialog } from "@/components/ui/dialog";
import { WzDialogContent } from "@/features/inventory/item-edit/wz";
import { JobItemPopup, type JobItemPopupProps } from "./job-item-popup";

const product = (over: Partial<Product> = {}): Product => ({
  id: "p1",
  sku: "SLK-3557",
  name: "Premium Entry Combo Lockset",
  category: "locks",
  type: ProductType.PRODUCT,
  costCompany: 35.18,
  costTech: 40,
  priceClient: 330,
  serialTracking: false,
  minimumStockLevel: 0,
  status: InventoryStatus.ACTIVE,
  createdAt: "",
  updatedAt: "",
  customAttributes: { Link_UHS: "https://www.uhs-hardware.com/x" },
  ...over,
});

const attribute = (name: string, over: Partial<ItemAttribute> = {}): ItemAttribute => ({
  id: `attr-${name}`,
  name,
  type: "text",
  visible: false,
  resource: "items",
  ...over,
});

const user = () => userEvent.setup({ pointerEventsCheck: 0 });

function renderPopup(over: Partial<JobItemPopupProps> = {}) {
  const onSave = vi.fn();
  const props: JobItemPopupProps = {
    product: product(),
    isEdit: false,
    mayCost: true,
    bandBinds: false,
    bandExempt: false,
    stockKnown: true,
    available: 5,
    stockCredit: 0,
    locations: [{ techId: "t1", label: "Bob Wrench's van", available: 5 }],
    fields: mocks.attributes,
    techId: "t1",
    users: [
      { id: "u1", firstName: "Ann", lastName: "Seller" },
      { id: "u2", firstName: "Carl", lastName: "Sales" },
    ],
    pending: false,
    onSave,
    onClose: vi.fn(),
    ...over,
  };
  // The card sits in a dialog, as on the page: its header's × is a dialog close.
  render(
    <Dialog open onOpenChange={() => {}}>
      <WzDialogContent>
        <JobItemPopup {...props} />
      </WzDialogContent>
    </Dialog>,
  );
  return { onSave, props };
}

beforeEach(() => {
  mocks.attributes = [];
});

describe("JobItemPopup — Workiz's \"Add job item\" card", () => {
  it("shows the item's name (the catalog's, as Workiz keeps it), quantity, price, markup and cost", () => {
    renderPopup();
    expect(screen.getByText("Add job item")).toBeInTheDocument();
    expect(screen.getByLabelText("Item Name")).toHaveValue("Premium Entry Combo Lockset");
    expect(screen.getByLabelText("Quantity")).toHaveValue(1);
    expect(screen.getByLabelText("Price")).toHaveValue(330);
    expect(screen.getByLabelText("Markup")).toHaveValue(838.03);
    expect(screen.getByLabelText("Cost")).toHaveValue(35.18);
  });

  it("typing a markup reprices the line; typing a price or a cost re-marks it", () => {
    renderPopup();
    fireEvent.change(screen.getByLabelText("Markup"), { target: { value: "100" } });
    expect(screen.getByLabelText("Price")).toHaveValue(70.36);

    fireEvent.change(screen.getByLabelText("Price"), { target: { value: "45" } });
    expect(screen.getByLabelText("Markup")).toHaveValue(27.91);

    fireEvent.change(screen.getByLabelText("Cost"), { target: { value: "30" } });
    expect(screen.getByLabelText("Markup")).toHaveValue(50);
  });

  it("hides Cost and Markup from a caller without financials.view", () => {
    renderPopup({ mayCost: false });
    expect(screen.queryByLabelText("Cost")).toBeNull();
    expect(screen.queryByLabelText("Markup")).toBeNull();
    expect(screen.getByLabelText("Price")).toHaveValue(330);
  });

  it("lists the item catalog's custom fields with the item's values, and saves them on the line", async () => {
    mocks.attributes = [
      attribute("ALL SKU"),
      attribute("Link_UHS"),
      attribute("SKU_CRM"),
      // The import's orphans (a value with no field in Workiz) are not fields the office sees.
      { ...attribute("workiz_attr_190"), orphan: true } as ItemAttribute,
    ];
    const u = user();
    const { onSave } = renderPopup();

    expect(screen.getByLabelText("Link_UHS")).toHaveValue("https://www.uhs-hardware.com/x");
    expect(screen.getByLabelText("ALL SKU")).toHaveValue("");
    expect(screen.queryByLabelText("workiz_attr_190")).toBeNull();
    await u.type(screen.getByLabelText("SKU_CRM"), "CRM-9");
    await u.click(screen.getByRole("button", { name: "Save" }));

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave.mock.calls[0][0]).toMatchObject({
      customAttributes: { Link_UHS: "https://www.uhs-hardware.com/x", SKU_CRM: "CRM-9" },
    });
  });

  it("saves the line as Workiz's card holds it: name, qty, price, cost, taxable, sold by, van", async () => {
    const u = user();
    const { onSave } = renderPopup();

    fireEvent.change(screen.getByLabelText("Item Name"), { target: { value: "Combo Lockset, bronze" } });
    fireEvent.change(screen.getByLabelText("Quantity"), { target: { value: "2" } });
    fireEvent.change(screen.getByLabelText("Cost"), { target: { value: "30" } });
    await u.click(screen.getByRole("switch", { name: "Taxable Item" }));
    await u.click(screen.getByRole("combobox", { name: "Sold by" }));
    await u.click(screen.getByRole("option", { name: "Carl Sales" }));
    await u.click(screen.getByRole("button", { name: "Save" }));

    expect(onSave.mock.calls[0][0]).toMatchObject({
      productId: "p1",
      name: "Combo Lockset, bronze",
      quantity: 2,
      priceClient: 330,
      costCompany: 30,
      taxable: false,
      soldBy: "u2",
      fulfillment: "sourced",
      sourceTechId: "t1",
    });
  });

  it("Inventory location None makes a part a to-order line; a service never asks", async () => {
    const u = user();
    const { onSave } = renderPopup();

    await u.click(screen.getByRole("combobox", { name: "Inventory location" }));
    await u.click(screen.getByRole("option", { name: "None" }));
    expect(screen.getByText(/added as an item to order/i)).toBeInTheDocument();
    await u.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave.mock.calls[0][0]).toMatchObject({ fulfillment: "to_order" });
    expect(onSave.mock.calls[0][0]).not.toHaveProperty("sourceTechId");
  });

  it("a service is added directly — no location, no stock", async () => {
    const u = user();
    const { onSave } = renderPopup({ product: product({ type: ProductType.SERVICE }) });

    expect(screen.queryByRole("combobox", { name: "Inventory location" })).toBeNull();
    await u.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave.mock.calls[0][0]).toMatchObject({ fulfillment: "service" });
  });

  it("more than the van holds goes to order, and says so", () => {
    renderPopup({ available: 1 });
    fireEvent.change(screen.getByLabelText("Quantity"), { target: { value: "3" } });
    expect(screen.getByText(/only has 1/i)).toBeInTheDocument();
  });

  it("holds a technician to the ±15% band and disables Save outside it", () => {
    renderPopup({ bandBinds: true, mayCost: false });
    fireEvent.change(screen.getByLabelText("Price"), { target: { value: "500" } });
    expect(screen.getByText(/allowed .*±15%/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("an edit opens on the line's own values and offers Change item", async () => {
    const u = user();
    const onChangeItem = vi.fn();
    renderPopup({
      isEdit: true,
      onChangeItem,
      initial: { name: "Lockset (renamed)", quantity: 3, price: 300, cost: 20, taxable: false, description: "Front door", soldBy: "u1", customAttributes: {} },
    });

    expect(screen.getByText("Edit job item")).toBeInTheDocument();
    expect(screen.getByLabelText("Item Name")).toHaveValue("Lockset (renamed)");
    expect(screen.getByLabelText("Quantity")).toHaveValue(3);
    expect(screen.getByLabelText("Cost")).toHaveValue(20);
    expect(screen.getByPlaceholderText("Description")).toHaveValue("Front door");
    expect(screen.getByRole("switch", { name: "Taxable Item" })).toHaveAttribute("aria-checked", "false");
    await u.click(screen.getByRole("button", { name: "Change item" }));
    expect(onChangeItem).toHaveBeenCalled();
  });

  it("Close closes without saving", async () => {
    const u = user();
    const { onSave, props } = renderPopup();
    // The footer's Close (the header's × is the dialog's own close).
    await u.click(screen.getAllByRole("button", { name: "Close" }).at(-1)!);
    expect(props.onClose).toHaveBeenCalled();
    expect(onSave).not.toHaveBeenCalled();
  });
});
