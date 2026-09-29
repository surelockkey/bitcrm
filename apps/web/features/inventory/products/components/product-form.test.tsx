import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ProductType } from "@bitcrm/types";
import { ProductForm, type ProductFormValues } from "./product-form";

type FormProps = Parameters<typeof ProductForm>[0];

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
  manageStock: true,
};

/**
 * The form sits in a popup whose footer holds the buttons, so it has none of
 * its own: the footer's Save submits it through `form={formId}`.
 */
function renderForm(
  defaults: ProductFormValues | undefined,
  onSubmit: (v: ProductFormValues, changed: Partial<ProductFormValues>) => void,
  over: Partial<FormProps> = {},
) {
  const utils = render(
    <>
      <ProductForm
        formId="product-form"
        mode="edit"
        defaults={defaults}
        showCompanyCost
        categories={[]}
        brands={[]}
        onSubmit={onSubmit}
        {...over}
      />
      <button type="submit" form="product-form">
        Save changes
      </button>
    </>,
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

    void container;
    await user.click(screen.getByRole("combobox", { name: "Type" }));
    await user.click(await screen.findByRole("option", { name: "Service" }));
    await user.click(save());

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][1]).toEqual({ type: ProductType.SERVICE });
  });
});

describe("ProductForm — buttons live in the popup's footer", () => {
  it("renders no Save or Cancel of its own", () => {
    renderForm(imported, vi.fn());
    expect(screen.queryByRole("button", { name: /cancel/i })).toBeNull();
    // The only Save is the harness's footer button.
    expect(screen.getAllByRole("button", { name: /save/i })).toHaveLength(1);
  });
});

const item: ProductFormValues = {
  ...imported,
  name: "Deadbolt",
  description: "",
  category: "Locks",
  priceClient: 45,
  manageStock: true,
  brandId: "b1",
  reorderLevel: 2,
};

const brands = [
  { id: "b1", name: "Schlage", active: true },
  { id: "b2", name: "Kwikset", active: true },
  { id: "b3", name: "Old Brand", active: false },
];

const categories = [
  { name: "Locks", active: true },
  { name: "Keys", active: true },
  { name: "Retired", active: false },
];

describe("ProductForm — Track stock (Workiz Manage stock)", () => {
  it("is on for a new product and gone for a service", async () => {
    const user = userEvent.setup();
    renderForm(undefined, vi.fn(), { mode: "create" });

    expect(screen.getByRole("switch", { name: "Track stock" })).toBeChecked();

    await user.click(screen.getByRole("combobox", { name: "Type" }));
    await user.click(await screen.findByRole("option", { name: "Service" }));
    expect(screen.queryByRole("switch", { name: "Track stock" })).toBeNull();
  });

  it("sends manageStock: false when it is switched off", async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    const { save } = renderForm(item, onSubmit);

    await user.click(screen.getByRole("switch", { name: "Track stock" }));
    await user.click(save());

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][1]).toEqual({ manageStock: false });
  });

  it("sends a Taxable change too (the edit schema used to strip it)", async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    const { save } = renderForm(item, onSubmit);

    await user.click(screen.getByRole("switch", { name: "Taxable" }));
    await user.click(save());

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][1]).toEqual({ taxable: false });
  });
});

describe("ProductForm — Brand", () => {
  it("offers No brand, the active brands, and the item's own archived one", async () => {
    const user = userEvent.setup();
    renderForm({ ...item, brandId: "b3" }, vi.fn(), { brands });

    await user.click(screen.getByRole("combobox", { name: "Brand" }));
    const names = (await screen.findAllByRole("option")).map((o) => o.textContent);
    expect(names).toEqual(["No brand", "Schlage", "Kwikset", "Old Brand"]);
  });

  it("leaves an archived brand out for an item that doesn't have it", async () => {
    const user = userEvent.setup();
    renderForm(item, vi.fn(), { brands });

    await user.click(screen.getByRole("combobox", { name: "Brand" }));
    const names = (await screen.findAllByRole("option")).map((o) => o.textContent);
    expect(names).not.toContain("Old Brand");
  });

  it("sends the picked brand, and '' for No brand", async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    const { save } = renderForm(item, onSubmit, { brands });

    await user.click(screen.getByRole("combobox", { name: "Brand" }));
    await user.click(await screen.findByRole("option", { name: "No brand" }));
    await user.click(save());

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][1]).toEqual({ brandId: "" });
  });

  it("is not shown when there is no brand catalog to pick from", () => {
    renderForm(item, vi.fn(), { brands: [] });
    expect(screen.queryByRole("combobox", { name: "Brand" })).toBeNull();
  });
});

describe("ProductForm — Reorder level", () => {
  it("sends a whole number", async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    const { field, save } = renderForm(item, onSubmit);

    await user.clear(field("reorderLevel"));
    await user.type(field("reorderLevel"), "4");
    await user.click(save());

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][1]).toEqual({ reorderLevel: 4 });
  });

  it("rejects a negative one", async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    const { field, save } = renderForm(item, onSubmit);

    await user.clear(field("reorderLevel"));
    await user.type(field("reorderLevel"), "-1");
    await user.click(save());

    expect(await screen.findByText("Must be 0 or more")).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("is not asked for a service", () => {
    const { field } = renderForm({ ...item, type: ProductType.SERVICE }, vi.fn());
    expect(field("reorderLevel")).toBeNull();
  });
});

describe("ProductForm — Category from the catalog", () => {
  it("is a select of the active categories plus the item's own", async () => {
    const user = userEvent.setup();
    renderForm({ ...item, category: "Retired" }, vi.fn(), { categories });

    await user.click(screen.getByRole("combobox", { name: "Category" }));
    const names = (await screen.findAllByRole("option")).map((o) => o.textContent);
    expect(names).toEqual(["Keys", "Locks", "Retired"]);
  });

  it("sends the picked category", async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    const { save } = renderForm(item, onSubmit, { categories });

    await user.click(screen.getByRole("combobox", { name: "Category" }));
    await user.click(await screen.findByRole("option", { name: "Keys" }));
    await user.click(save());

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][1]).toEqual({ category: "Keys" });
  });

  it("falls back to free text when the catalog is empty", () => {
    const { field } = renderForm(item, vi.fn(), { categories: [] });
    expect(field("category").tagName).toBe("INPUT");
  });
});
