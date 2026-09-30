import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { InventoryStatus, ProductType } from "@bitcrm/types";
import type { Brand, ItemAttribute, Product, ProductCategory } from "@bitcrm/types";
import { renderWithClient } from "@/test/render-with-client";
import { ApiError } from "@/lib/api/errors";

const mocks = vi.hoisted(() => ({
  denied: new Set<string>(),
  pathname: "/inventory/items",
  product: undefined as unknown,
  categories: [] as ProductCategory[],
  brands: [] as Brand[],
  attributes: [] as ItemAttribute[],
  update: vi.fn(),
  create: vi.fn(),
  archive: vi.fn(),
  reactivate: vi.fn(),
  uploadUrl: vi.fn(),
  uploadBytes: vi.fn(),
  removePhoto: vi.fn(),
}));

vi.mock("@/features/auth/use-permissions", () => ({
  useDenied: () => () => false,
  usePermissions: () => ({
    isLoading: false,
    can: (resource: string, action = "view") => !mocks.denied.has(`${resource}.${action}`),
  }),
}));
vi.mock("next/navigation", () => ({ usePathname: () => mocks.pathname }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

vi.mock("@/features/inventory/products/api", () => ({
  getProduct: async () => {
    if (mocks.product instanceof Error) throw mocks.product;
    return mocks.product;
  },
  listItemCategories: async () => mocks.categories,
  listBrands: async () => mocks.brands,
  getPhotoDownloadUrl: async () => ({ downloadUrl: "https://photos/p1.png" }),
  updateProduct: (id: string, body: unknown) => mocks.update(id, body),
  createProduct: (body: unknown) => mocks.create(body),
  archiveProduct: (id: string) => mocks.archive(id),
  reactivateProduct: (id: string) => mocks.reactivate(id),
  getPhotoUploadUrl: (id: string, type: string) => mocks.uploadUrl(id, type),
  uploadPhotoBytes: (url: string, file: File) => mocks.uploadBytes(url, file),
  removePhoto: (id: string) => mocks.removePhoto(id),
}));
vi.mock("@/features/inventory/item-attributes/api", () => ({
  listItemAttributes: async () => mocks.attributes,
  createItemAttribute: vi.fn(),
  updateItemAttribute: vi.fn(),
  deleteItemAttribute: vi.fn(),
}));

import { ProductDialog, variantForPath } from "./product-dialog";

/** The item on Workiz's reference screenshots. */
function chainGuard(over: Partial<Product> = {}): Product {
  return {
    id: "p1",
    number: 3551,
    sku: "1607-625 (SLK-3551)",
    name: "Don-Jo - Chain Guard - Silver (1607-625) (SLK-3551)",
    description: "SLK-3551\n UPC: 040186243617",
    category: "Door Hardware",
    type: ProductType.PRODUCT,
    costCompany: 20.16,
    costTech: 18,
    priceClient: 125,
    taxable: true,
    brandId: "b-slk",
    barcode: "040186243617",
    supplier: "UHS",
    serialTracking: false,
    minimumStockLevel: 0,
    reorderLevel: 0,
    manageStock: true,
    onHand: 369,
    photoKey: "products/p1/a.png",
    status: InventoryStatus.ACTIVE,
    createdAt: "",
    updatedAt: "2026-09-30T00:00:00Z",
    customAttributes: { Link_UHS: "https://uhs/chain", workiz_attr_77: "orphan" },
    ...over,
  };
}

/** The Price Book item on Workiz's reference screenshots. */
function keyCopy(over: Partial<Product> = {}): Product {
  return chainGuard({
    id: "p2",
    sku: "WZ-2475",
    name: "Key Copy Sc1",
    description: undefined,
    category: "Uncategorized",
    costCompany: 2,
    priceClient: 6,
    brandId: undefined,
    manageStock: false,
    photoKey: undefined,
    customAttributes: undefined,
    priceBookEnabled: true,
    availableInBooking: false,
    ...over,
  });
}

function open(
  productId: string | null,
  { variant, onCreated = vi.fn() }: { variant?: "inventory" | "price-book"; onCreated?: (p: Product) => void } = {},
) {
  const onOpenChange = vi.fn();
  renderWithClient(
    <ProductDialog productId={productId} open onOpenChange={onOpenChange} onCreated={onCreated} variant={variant} />,
  );
  return { onOpenChange, onCreated };
}

const dialog = () => screen.getByTestId("item-edit-dialog");
const left = () => screen.getByTestId("item-edit-left");
const right = () => screen.getByTestId("item-edit-right");

/** A column's fields top to bottom: input labels, selects, the category, textareas and switches. */
function columnFields(column: HTMLElement): string[] {
  return [
    ...column.querySelectorAll(
      "label[for], button[role=combobox], textarea, button[role=switch], [data-testid=category-field]",
    ),
  ].map((el) => {
    if (el.matches("textarea")) return (el as HTMLTextAreaElement).placeholder;
    if (el.matches("[data-testid=category-field]")) return "Choose category (optional)";
    return el.getAttribute("aria-label") ?? el.textContent ?? "";
  });
}

beforeEach(() => {
  mocks.denied = new Set();
  mocks.pathname = "/inventory/items";
  mocks.product = chainGuard();
  mocks.categories = [
    { id: "c1", name: "Door Hardware", active: true, createdBy: "", createdAt: "", updatedAt: "" },
    { id: "c2", name: "Locks", active: true, createdBy: "", createdAt: "", updatedAt: "" },
  ];
  mocks.brands = [
    { id: "b-slk", name: "SLK", active: true, createdBy: "", createdAt: "", updatedAt: "" },
    { id: "b-uhs", name: "UHS", active: true, createdBy: "", createdAt: "", updatedAt: "" },
  ];
  mocks.attributes = ["ALL SKU", "In Store Location", "Link_UHS"].map((name, i) => ({
    id: `attr-${i}`,
    name,
    type: "text",
    visible: false,
    resource: "items",
  }));
  mocks.update.mockReset().mockImplementation(async (id, body) => ({ ...chainGuard(), id, ...body }));
  mocks.create.mockReset().mockImplementation(async (body) => ({ ...chainGuard(), ...body, id: "new-1" }));
  mocks.archive
    .mockReset()
    .mockImplementation(async (id) => ({ ...chainGuard(), id, status: InventoryStatus.ARCHIVED }));
  mocks.reactivate.mockReset().mockImplementation(async (id) => ({ ...chainGuard(), id }));
  mocks.uploadUrl.mockReset().mockResolvedValue({ uploadUrl: "https://s3/put", key: "k" });
  mocks.uploadBytes.mockReset().mockResolvedValue(undefined);
  mocks.removePhoto.mockReset().mockResolvedValue(chainGuard({ photoKey: undefined }));
});

describe("Edit Inventory item (Workiz layout)", () => {
  it("has Workiz's fields, in Workiz's order and words, in two columns", async () => {
    open("p1");
    expect(await screen.findByRole("heading", { name: "Edit Inventory item" })).toBeInTheDocument();
    await screen.findByDisplayValue("125.00");

    expect(columnFields(left())).toEqual([
      "Product name",
      "Select brand (optional)",
      "Choose category (optional)",
      "SKU",
      "Re-order at",
      "Minimum at location",
    ]);
    expect(columnFields(right())).toEqual(["Price", "Cost", "Description", "Taxable item"]);

    expect(screen.getByLabelText("Product name")).toHaveValue(
      "Don-Jo - Chain Guard - Silver (1607-625) (SLK-3551)",
    );
    expect(await screen.findByRole("combobox", { name: "Select brand (optional)" })).toHaveTextContent("SLK");
    expect(within(screen.getByTestId("category-field")).getByText("Door Hardware")).toBeInTheDocument();
    expect(screen.getByLabelText("Cost")).toHaveValue("20.16");
    expect(screen.getByRole("switch", { name: "Taxable item" })).toHaveAttribute("aria-checked", "true");
    expect(await screen.findByLabelText("Link_UHS")).toHaveValue("https://uhs/chain");
    expect(screen.getByRole("button", { name: "Add custom fields" })).toBeInTheDocument();
    expect(
      within(screen.getByTestId("wz-footer"))
        .getAllByRole("button")
        .map((b) => b.textContent),
    ).toEqual(["Cancel", "Save"]);
  });

  it("shows nothing Workiz doesn't: no rail, stats, margins, badges or BitCRM-only fields", async () => {
    open("p1");
    await screen.findByDisplayValue("125.00");
    const text = dialog().textContent ?? "";
    for (const gone of [
      "Pricing",
      "Company cost",
      "Tech cost",
      "Client price",
      "Barcode",
      "Supplier",
      "Serial tracking",
      "Track stock",
      "margin",
      "On hand",
      "Archive",
      "Active",
      "#3551",
      "Identity",
    ]) {
      expect(text).not.toContain(gone);
    }
  });

  it("scrolls down only: the card and the body never scroll sideways, columns shrink instead", async () => {
    open("p1");
    await screen.findByDisplayValue("125.00");
    expect(dialog().className).toMatch(/\boverflow-(x-)?hidden\b/);
    const body = screen.getByTestId("item-edit-scroll");
    expect(body).toHaveClass("overflow-y-auto", "overflow-x-hidden", "min-w-0");
    expect(screen.getByTestId("item-edit-columns").className).toContain(
      "md:grid-cols-[minmax(0,1fr)_minmax(0,0.8fr)]",
    );
    expect(left()).toHaveClass("min-w-0");
    expect(right()).toHaveClass("min-w-0");
    // The footer sits outside the scrolling body: it stays put.
    expect(body.contains(screen.getByTestId("wz-footer"))).toBe(false);
  });

  it("Save sends only what changed — Cost as the company cost, custom fields as a patch — then closes", async () => {
    const user = userEvent.setup();
    const { onOpenChange } = open("p1");
    const cost = await screen.findByLabelText("Cost");

    await user.clear(cost);
    await user.type(cost, "21.50");
    await user.type(await screen.findByLabelText("ALL SKU"), "A-1");
    await user.clear(screen.getByLabelText("Link_UHS"));
    await user.click(screen.getByRole("switch", { name: "Taxable item" }));
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(mocks.update).toHaveBeenCalledWith("p1", {
        costCompany: 21.5,
        taxable: false,
        customAttributes: { "ALL SKU": "A-1", Link_UHS: null },
      }),
    );
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(mocks.archive).not.toHaveBeenCalled();
  });

  it("an untouched Save closes without writing", async () => {
    const user = userEvent.setup();
    const { onOpenChange } = open("p1");
    await screen.findByDisplayValue("125.00");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("an invalid value keeps the popup open and says why", async () => {
    const user = userEvent.setup();
    open("p1");
    const price = await screen.findByLabelText("Price");
    await user.clear(price);
    await user.type(price, "abc");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Enter an amount");
    expect(price).toHaveAttribute("aria-invalid", "true");
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("the SKU is edited like the other fields (as in Workiz) and sent when changed", async () => {
    const user = userEvent.setup();
    open("p1");
    const sku = await screen.findByLabelText("SKU");
    expect(sku).toBeEnabled();
    expect(sku).not.toHaveAttribute("readonly");
    await user.clear(sku);
    await user.type(sku, "SLK-3551");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(mocks.update).toHaveBeenCalledWith("p1", { sku: "SLK-3551" }));
  });

  it("clearing the brand with × sends null", async () => {
    const user = userEvent.setup();
    open("p1");
    await user.click(await screen.findByRole("button", { name: "Clear Select brand (optional)" }));
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(mocks.update).toHaveBeenCalledWith("p1", { brandId: null }));
  });

  it("Browse picks a category", async () => {
    const user = userEvent.setup();
    open("p1");
    await screen.findByDisplayValue("125.00");
    await user.click(await screen.findByRole("button", { name: "Browse — Choose category (optional)" }));
    const picker = screen.getByTestId("category-picker");
    await user.click(within(picker).getByRole("button", { name: "Locks" }));
    await user.click(within(picker).getByRole("button", { name: "Apply" }));
    expect(within(screen.getByTestId("category-field")).getByText("Locks")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(mocks.update).toHaveBeenCalledWith("p1", { category: "Locks" }));
  });

  it("a new photo is uploaded with Save, not before", async () => {
    const user = userEvent.setup();
    open("p1");
    await screen.findByDisplayValue("125.00");
    const file = new File(["x"], "door.png", { type: "image/png" });
    await user.upload(screen.getByTestId("photo-input"), file);
    expect(mocks.uploadUrl).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(mocks.uploadBytes).toHaveBeenCalledWith("https://s3/put", file));
    expect(mocks.uploadUrl).toHaveBeenCalledWith("p1", "image/png");
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("without financials.view there is no Cost field", async () => {
    mocks.denied = new Set(["financials.view"]);
    open("p1");
    await screen.findByDisplayValue("125.00");
    expect(screen.queryByLabelText("Cost")).not.toBeInTheDocument();
    expect(columnFields(right())).toEqual(["Price", "Description", "Taxable item"]);
  });

  it("view-only: every field is locked, no Save, no custom field management", async () => {
    mocks.denied = new Set(["products.edit"]);
    open("p1");
    await screen.findByDisplayValue("125.00");
    expect(screen.getByLabelText("Product name")).toBeDisabled();
    expect(screen.getByLabelText("Price")).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument();
    expect(await screen.findByLabelText("ALL SKU")).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Add custom fields" })).not.toBeInTheDocument();
  });

  it("an item that can't be read says so", async () => {
    mocks.product = new Error("404");
    open("p1");
    expect(await screen.findByRole("heading", { name: "Item not found" })).toBeInTheDocument();
  });
});

describe("Edit Item (Price Book layout)", () => {
  beforeEach(() => {
    mocks.product = keyCopy();
  });

  it("has Workiz's Price Book fields and switches, in order", async () => {
    open("p2", { variant: "price-book" });
    expect(await screen.findByRole("heading", { name: "Edit Item" })).toBeInTheDocument();
    await screen.findByDisplayValue("6.00");

    expect(columnFields(left())).toEqual([
      "Title",
      "Model #",
      "Choose category (optional)",
      "Item type",
      "Brand",
      "Item Description (optional)",
    ]);
    expect(columnFields(right())).toEqual([
      "Price",
      "Unit Cost",
      "Manage Inventory",
      "Taxable item",
      "Enable item",
      "Show item on price book",
      "Add to booking items",
    ]);
    expect(screen.getByRole("button", { name: "Delete Item" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /When off, the item is hidden from the price book/ }),
    ).toBeInTheDocument();
  });

  it("shows Model # and category the way Workiz does: the importer's WZ- SKU and Uncategorized are empty", async () => {
    const user = userEvent.setup();
    open("p2", { variant: "price-book" });
    await screen.findByDisplayValue("6.00");
    expect(screen.getByLabelText("Model #")).toHaveValue("");
    expect(screen.getByText("Model #", { selector: "label" })).not.toHaveAttribute("data-floated");
    const category = screen.getByTestId("category-field");
    expect(category).toHaveTextContent("Choose category (optional)");
    expect(category).not.toHaveTextContent("Uncategorized");
    expect(within(category).getAllByText("Choose category (optional)")).toHaveLength(1);

    // Left alone, neither is sent.
    await user.click(screen.getByRole("switch", { name: "Taxable item" }));
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(mocks.update).toHaveBeenCalledWith("p2", { taxable: false }));
  });

  it("the Workiz serial behind a WZ- SKU is what Model # shows", async () => {
    mocks.product = { ...keyCopy(), workizSerial: "KW1" };
    open("p2", { variant: "price-book" });
    expect(await screen.findByLabelText("Model #")).toHaveValue("KW1");
  });

  it("a taken SKU on an edit is said under the field", async () => {
    const user = userEvent.setup();
    mocks.update.mockRejectedValue(new ApiError(409, 'Product with SKU "KC-1" already exists'));
    const { onOpenChange } = open("p2", { variant: "price-book" });
    await user.type(await screen.findByLabelText("Model #"), "KC-1");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Another item already uses this SKU");
    expect(mocks.update).toHaveBeenCalledWith("p2", { sku: "KC-1" });
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it("Delete Item asks first, then archives the item and closes", async () => {
    const user = userEvent.setup();
    const { onOpenChange } = open("p2", { variant: "price-book" });
    await user.click(await screen.findByRole("button", { name: "Delete Item" }));
    const confirm = screen.getByRole("alertdialog");
    expect(within(confirm).getByText("Delete Item?")).toBeInTheDocument();
    await user.click(within(confirm).getByRole("button", { name: "Yes, delete" }));
    await waitFor(() => expect(mocks.archive).toHaveBeenCalledWith("p2"));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it("Enable item off archives the item on Save; Show item on price book is then locked", async () => {
    const user = userEvent.setup();
    open("p2", { variant: "price-book" });
    await screen.findByDisplayValue("6.00");
    await user.click(screen.getByRole("switch", { name: "Enable item" }));
    expect(screen.getByRole("switch", { name: "Show item on price book" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(mocks.archive).toHaveBeenCalledWith("p2"));
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("an archived item is switched back on with Enable item (and offers no Delete Item)", async () => {
    const user = userEvent.setup();
    mocks.product = keyCopy({ status: InventoryStatus.ARCHIVED });
    open("p2", { variant: "price-book" });
    await screen.findByDisplayValue("6.00");
    expect(screen.queryByRole("button", { name: "Delete Item" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("switch", { name: "Enable item" }));
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(mocks.reactivate).toHaveBeenCalledWith("p2"));
  });

  it("without products.delete there is no Delete Item and an item can't be switched off", async () => {
    mocks.denied = new Set(["products.delete"]);
    open("p2", { variant: "price-book" });
    await screen.findByDisplayValue("6.00");
    expect(screen.queryByRole("button", { name: "Delete Item" })).not.toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Enable item" })).toBeDisabled();
  });

  it("Add to booking items shows Booking Price and saves both", async () => {
    const user = userEvent.setup();
    open("p2", { variant: "price-book" });
    await screen.findByDisplayValue("6.00");
    await user.click(screen.getByRole("switch", { name: "Add to booking items" }));
    await user.type(screen.getByLabelText("Booking Price"), "40");
    await user.click(screen.getByRole("switch", { name: "Show item on price book" }));
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(mocks.update).toHaveBeenCalledWith("p2", {
        priceBookEnabled: false,
        availableInBooking: true,
        bookingPrice: 40,
      }),
    );
  });

  it("a service has no Brand and no Manage Inventory", async () => {
    mocks.product = keyCopy({ type: ProductType.SERVICE });
    open("p2", { variant: "price-book" });
    await screen.findByDisplayValue("6.00");
    expect(screen.queryByRole("combobox", { name: "Brand" })).not.toBeInTheDocument();
    expect(screen.queryByRole("switch", { name: "Manage Inventory" })).not.toBeInTheDocument();
  });

  it("a stocked product shows what is currently on hand", async () => {
    mocks.product = keyCopy({ manageStock: true, onHand: 12 });
    open("p2", { variant: "price-book" });
    expect(await screen.findByTestId("on-hand")).toHaveTextContent("Currently on hand12");
  });

  it("follows the page: a Price Book path opens “Edit Item” without being told", async () => {
    mocks.pathname = "/price-book/items";
    open("p2");
    expect(await screen.findByRole("heading", { name: "Edit Item" })).toBeInTheDocument();
    expect(variantForPath("/price-book/items")).toBe("price-book");
    expect(variantForPath("/inventory/items")).toBe("inventory");
    expect(variantForPath(null)).toBe("inventory");
  });
});

describe("New item", () => {
  it("“Add Inventory item”: same layout, Workiz defaults, Product name and SKU required", async () => {
    const user = userEvent.setup();
    const { onCreated } = open(null);
    expect(screen.getByRole("heading", { name: "Add Inventory item" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Upload Image" })).toBeInTheDocument();
    expect(screen.getByLabelText("Price")).toHaveValue("0.00");
    expect(screen.getByLabelText("Cost")).toHaveValue("0.00");
    expect(screen.getByRole("switch", { name: "Taxable item" })).toHaveAttribute("aria-checked", "true");

    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.getAllByRole("alert").map((a) => a.textContent)).toEqual(["Required"]);
    expect(screen.getByLabelText("Product name")).toHaveAttribute("aria-invalid", "true");
    expect(mocks.create).not.toHaveBeenCalled();

    await user.type(screen.getByLabelText("Product name"), "Deadbolt");
    await user.type(screen.getByLabelText("SKU"), "DB-1");
    await user.clear(screen.getByLabelText("Cost"));
    await user.type(screen.getByLabelText("Cost"), "10");
    await user.type(await screen.findByLabelText("In Store Location"), "Aisle 4");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(mocks.create).toHaveBeenCalledWith({
        name: "Deadbolt",
        sku: "DB-1",
        category: "Uncategorized",
        type: ProductType.PRODUCT,
        description: undefined,
        brandId: undefined,
        priceClient: 0,
        costCompany: 10,
        costTech: 10,
        taxable: true,
        serialTracking: false,
        manageStock: true,
        minimumStockLevel: 0,
        reorderLevel: undefined,
        customAttributes: { "In Store Location": "Aisle 4" },
      }),
    );
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(expect.objectContaining({ id: "new-1" })));
  });

  it("an empty SKU / Model # is allowed, as in Workiz: the body leaves it out", async () => {
    const user = userEvent.setup();
    open(null, { variant: "price-book" });
    await user.type(screen.getByLabelText("Title"), "Rekey");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(mocks.create).toHaveBeenCalled());
    expect("sku" in mocks.create.mock.calls[0][0]).toBe(false);
  });

  it("a taken SKU is said under the field and the popup stays open", async () => {
    const user = userEvent.setup();
    mocks.create.mockRejectedValue(new ApiError(409, 'Product with SKU "DB-1" already exists'));
    const { onCreated } = open(null);
    await user.type(screen.getByLabelText("Product name"), "Deadbolt");
    await user.type(screen.getByLabelText("SKU"), "DB-1");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Another item already uses this SKU");
    expect(screen.getByLabelText("SKU")).toHaveAttribute("aria-invalid", "true");
    expect(onCreated).not.toHaveBeenCalled();
  });

  it("“Add New Item”: a service by default — no Brand, Manage Inventory, Enable, Show or Delete", async () => {
    const user = userEvent.setup();
    open(null, { variant: "price-book" });
    expect(screen.getByRole("heading", { name: "Add New Item" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Item type" })).toHaveTextContent("Service");
    expect(columnFields(right())).toEqual(["Price", "Unit Cost", "Taxable item", "Add to booking items"]);
    expect(screen.queryByRole("combobox", { name: "Brand" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete Item" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("combobox", { name: "Item type" }));
    await user.click(await screen.findByRole("option", { name: "Product" }));
    expect(screen.getByRole("combobox", { name: "Brand" })).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Manage Inventory" })).toHaveAttribute("aria-checked", "false");
  });

  it("a picked photo is uploaded to the new item once it exists", async () => {
    const user = userEvent.setup();
    open(null);
    const file = new File(["x"], "new.jpg", { type: "image/jpeg" });
    await user.upload(screen.getByTestId("photo-input"), file);
    await user.type(screen.getByLabelText("Product name"), "Deadbolt");
    await user.type(screen.getByLabelText("SKU"), "DB-1");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(mocks.uploadUrl).toHaveBeenCalledWith("new-1", "image/jpeg"));
    expect(mocks.uploadBytes).toHaveBeenCalledWith("https://s3/put", file);
  });

  it("without products.create the popup says so", () => {
    mocks.denied = new Set(["products.create"]);
    open(null);
    expect(screen.getByText("You don't have permission to create items.")).toBeInTheDocument();
  });
});
