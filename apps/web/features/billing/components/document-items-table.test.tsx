import { describe, expect, it, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ProductType } from "@bitcrm/types";
import { renderWithClient } from "@/test/render-with-client";

vi.mock("@/features/inventory/warehouses/api", () => ({ fetchAllProducts: () => Promise.resolve([]) }));

import { DocumentItemsTable, type DocumentItemsTableProps, type DocumentLineItem } from "./document-items-table";

const line: DocumentLineItem = {
  lineId: "l1", position: 0, productId: "p1", productType: ProductType.SERVICE, name: "Push bar install",
  sku: "PB-1", description: "Supply and install a grade 3 push bar.", quantity: 1, priceClient: 912.17,
  costCompany: 0, costForTech: 0, taxable: true,
};

function setup(over: Partial<DocumentItemsTableProps> = {}) {
  const props: DocumentItemsTableProps = {
    variant: "workiz",
    items: [line],
    canEdit: true,
    emptyText: "No items on this estimate yet.",
    pending: { add: false, update: false },
    onAdd: vi.fn(),
    onUpdate: vi.fn(),
    onRemove: vi.fn(),
    onReorder: vi.fn(),
    onTaxable: vi.fn(),
    ...over,
  };
  renderWithClient(<DocumentItemsTable {...props} />);
  return props;
}

const user = () => userEvent.setup({ pointerEventsCheck: 0 });

/** Workiz's Items grid on the estimate page (pg_estimate_wz_01_job). */
describe("DocumentItemsTable — variant workiz", () => {
  it("draws Workiz's columns and prints the line as words: 1.00, $912.17, Yes, its tags", () => {
    setup();
    const heads = screen.getAllByRole("columnheader").map((h) => h.textContent?.trim()).filter(Boolean);
    expect(heads).toEqual(["Item", "Quantity", "Price", "Cost", "Amount", "Taxable", "Actions"]);
    const row = screen.getByRole("row", { name: /push bar install/i });
    expect(within(row).getByText("1.00")).toBeInTheDocument();
    expect(within(row).getAllByText("$912.17")).toHaveLength(2);
    expect(within(row).getByText("Yes")).toBeInTheDocument();
    expect(within(row).getByText("Supply and install a grade 3 push bar.")).toBeInTheDocument();
    expect(within(row).getByText("Service")).toBeInTheDocument();
    expect(within(row).getByText("Taxable")).toBeInTheDocument();
    expect(within(row).queryByRole("spinbutton")).not.toBeInTheDocument();
  });

  it("edits the price in place: the words become a box, Enter saves", async () => {
    const props = setup();
    const u = user();
    await u.click(screen.getByRole("button", { name: "Edit Push bar install price" }));
    const box = screen.getByRole("spinbutton", { name: "Push bar install price" });
    expect(box).toHaveFocus();
    await u.clear(box);
    await u.type(box, "950{Enter}");
    expect(props.onUpdate).toHaveBeenCalledWith("l1", expect.objectContaining({ priceClient: 950, quantity: 1 }));
    expect(screen.queryByRole("spinbutton", { name: "Push bar install price" })).not.toBeInTheDocument();
  });

  it("Escape leaves the quantity as it was", async () => {
    const props = setup();
    const u = user();
    await u.click(screen.getByRole("button", { name: "Edit Push bar install quantity" }));
    await u.type(screen.getByRole("spinbutton", { name: "Push bar install quantity" }), "5{Escape}");
    expect(props.onUpdate).not.toHaveBeenCalled();
    expect(screen.getByText("1.00")).toBeInTheDocument();
  });

  it("flips Taxable from its word", async () => {
    const props = setup();
    await user().click(screen.getByRole("checkbox", { name: /push bar install is taxable/i }));
    expect(props.onTaxable).toHaveBeenCalledWith("l1", false);
  });

  it("removes a line from the Actions column", async () => {
    const props = setup();
    await user().click(screen.getByRole("button", { name: "Remove Push bar install" }));
    expect(props.onRemove).toHaveBeenCalledWith("l1");
  });

  it("an empty grid shows Workiz's 'Add items' under the headings", () => {
    setup({ items: [] });
    expect(screen.getByRole("button", { name: "Add items" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Item" })).toBeInTheDocument();
  });

  it("a reader sees words only: no editing, no Actions column", () => {
    setup({ canEdit: false });
    expect(screen.queryByRole("columnheader", { name: "Actions" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /edit push bar install price/i })).not.toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: /push bar install is taxable/i })).toBeDisabled();
  });

  // pg_invoice_wz_01_partial: a product line carries an outlined PRODUCT tag, as a service line SERVICE.
  it("tags a product line 'Product'", () => {
    setup({ items: [{ ...line, productType: ProductType.PRODUCT, taxable: false }] });
    const row = screen.getByRole("row", { name: /push bar install/i });
    expect(within(row).getByText("Product")).toBeInTheDocument();
    expect(within(row).queryByText("Service")).toBeNull();
  });

  /*
   * A job's invoice: the lines ARE the job's items, which have their own item
   * window (the job's, with its technicians and stock) and no order of their
   * own — so the page opens its window, and the grid neither drags nor edits
   * numbers in place.
   */
  it("hands Add item and a line to the page's own item window when it has one", async () => {
    const onOpenLine = vi.fn();
    setup({ onOpenLine, reorderable: false, inlineEdit: false, emptyAction: "Add line items" });
    const u = user();
    await u.click(screen.getByRole("button", { name: /^add item$/i }));
    expect(onOpenLine).toHaveBeenLastCalledWith(null);
    await u.click(screen.getByRole("button", { name: "Edit Push bar install" }));
    expect(onOpenLine).toHaveBeenLastCalledWith("l1");
    expect(screen.queryByRole("button", { name: /reorder push bar install/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /edit push bar install price/i })).toBeNull();
    expect(screen.getByRole("row", { name: /push bar install/i })).toHaveTextContent("$912.17");
  });

  it("says the page's own words on an empty grid ('Add line items' on an invoice)", async () => {
    const onOpenLine = vi.fn();
    setup({ items: [], onOpenLine, emptyAction: "Add line items" });
    await user().click(screen.getByRole("button", { name: "Add line items" }));
    expect(onOpenLine).toHaveBeenCalledWith(null);
  });
});
