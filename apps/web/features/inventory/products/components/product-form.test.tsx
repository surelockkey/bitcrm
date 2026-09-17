import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ProductType } from "@bitcrm/types";
import { ProductForm, type ProductFormValues } from "./product-form";

/**
 * Editing an item the Workiz importer wrote. 262 of the 15 832 price-book
 * items have a name over the form's 120-char cap, 144 a description over
 * 1 000, and 61 a negative price — the form must still open and still save the
 * one field the user came to fix.
 */
const imported: ProductFormValues = {
  name: "L".repeat(262),
  sku: "WZ-10707",
  barcode: "",
  description: "D".repeat(1400),
  category: "Uncategorized",
  type: ProductType.PRODUCT,
  costCompany: 0,
  costTech: 0,
  priceClient: -35,
  taxable: true,
  supplier: "",
  serialTracking: false,
  minimumStockLevel: 0,
};

function renderForm(
  defaults: ProductFormValues,
  onSubmit: (v: ProductFormValues, changed: Partial<ProductFormValues>) => void,
) {
  const utils = render(
    <ProductForm
      mode="edit"
      defaults={defaults}
      showCompanyCost
      categories={[]}
      submitting={false}
      submitLabel="Save changes"
      onSubmit={onSubmit}
      onCancel={() => {}}
    />,
  );
  // The form's <Label>s are not wired to their inputs, so address fields by
  // the name react-hook-form registers.
  const field = (name: keyof ProductFormValues) =>
    utils.container.querySelector(`[name="${name}"]`) as HTMLElement;
  const save = () => screen.getByRole("button", { name: "Save changes" });
  return { ...utils, field, save };
}

describe("ProductForm (edit mode)", () => {
  it("saves an imported item, sending only the field that changed", async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    const { field, save } = renderForm(imported, onSubmit);

    await user.clear(field("category"));
    await user.type(field("category"), "Locks");
    await user.click(save());

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    const [values, changed] = onSubmit.mock.calls[0];
    expect(values.category).toBe("Locks");
    // The out-of-range name/price are left out of the body entirely, so the
    // API never re-validates them.
    expect(changed).toEqual({ category: "Locks" });
  });

  it("does not block the save on the imported values it did not touch", async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    const { save } = renderForm(imported, onSubmit);

    await user.click(save());

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][1]).toEqual({});
  });

  it("still rejects a value the user makes invalid", async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    const { field, save } = renderForm({ ...imported, name: "Deadbolt" }, onSubmit);

    await user.clear(field("name"));
    await user.click(save());

    expect(await screen.findByText("Name is required")).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("still rejects a name the user pushes over the cap", async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    const { field, save } = renderForm({ ...imported, name: "Deadbolt" }, onSubmit);

    await user.clear(field("name"));
    await user.type(field("name"), "N".repeat(121));
    await user.click(save());

    expect(
      await screen.findByText("Must be 120 characters or fewer"),
    ).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("marks the type select dirty so a type change is sent", async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    const { container, save } = renderForm(
      { ...imported, name: "Deadbolt", description: "", priceClient: 45 },
      onSubmit,
    );

    const trigger = container.querySelector(
      'button[role="combobox"]',
    ) as HTMLElement;
    await user.click(trigger);
    await user.click(await screen.findByRole("option", { name: "Service" }));
    await user.click(save());

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][1]).toEqual({ type: ProductType.SERVICE });
  });
});
