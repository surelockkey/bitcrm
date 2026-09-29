import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { InventoryStatus, ProductType } from "@bitcrm/types";
import type { Brand, Product, ProductCategory } from "@bitcrm/types";
import { renderWithClient } from "@/test/render-with-client";

type Mutate = (vars: unknown, opts?: { onSuccess?: (data: unknown) => void }) => void;

const mocks = vi.hoisted(() => ({
  denied: new Set<string>(),
  product: { isLoading: false, isError: false, data: undefined as Product | undefined },
  categories: [] as ProductCategory[],
  brands: [] as Brand[],
  catalogsEnabled: [] as [string, boolean][],
  update: vi.fn(),
  create: vi.fn(),
  archive: vi.fn(),
  reactivate: vi.fn(),
}));

vi.mock("@/features/auth/use-permissions", () => ({
  useDenied: () => () => false,
  usePermissions: () => ({
    can: (resource: string, action = "view") => !mocks.denied.has(`${resource}.${action}`),
  }),
}));

// A mutation that succeeds at once, handing `onSuccess` what the server would.
const mutation = (fn: (vars: unknown) => void, result?: (vars: unknown) => unknown) => ({
  isPending: false,
  mutate: ((vars, opts) => {
    fn(vars);
    opts?.onSuccess?.(result ? result(vars) : undefined);
  }) as Mutate,
});

vi.mock("../hooks", () => ({
  useProduct: () => mocks.product,
  useItemCategories: (enabled: boolean) => {
    mocks.catalogsEnabled.push(["categories", enabled]);
    return { data: enabled ? mocks.categories : undefined };
  },
  useBrands: (enabled: boolean) => {
    mocks.catalogsEnabled.push(["brands", enabled]);
    return { data: enabled ? mocks.brands : undefined };
  },
  useUpdateProduct: () => mutation(mocks.update),
  useCreateProduct: () => mutation(mocks.create, (v) => ({ ...(v as object), id: "new-1" })),
  useArchiveProduct: () => mutation(mocks.archive),
  useReactivateProduct: () => mutation(mocks.reactivate),
}));
vi.mock("./product-photo-panel", () => ({ ProductPhotoPanel: () => <div>Photo panel</div> }));

import { ProductDialog } from "./product-dialog";

function product(over: Partial<Product> = {}): Product {
  return {
    id: "p1",
    number: 1042,
    sku: "LOCK-001",
    name: "Deadbolt",
    category: "Locks",
    type: ProductType.PRODUCT,
    costCompany: 10,
    costTech: 18,
    priceClient: 45,
    serialTracking: false,
    minimumStockLevel: 5,
    onHand: 12,
    status: InventoryStatus.ACTIVE,
    createdAt: "",
    updatedAt: "2026-09-01T00:00:00Z",
    ...over,
  };
}

// The form's <Label>s are not wired to their inputs; address them by name.
const field = (name: string) =>
  document.querySelector(`[role="dialog"] [name="${name}"]`) as HTMLInputElement;

function open(productId: string | null, over: { onCreated?: (p: Product) => void } = {}) {
  const onOpenChange = vi.fn();
  const onCreated = over.onCreated ?? vi.fn();
  renderWithClient(
    <ProductDialog productId={productId} open onOpenChange={onOpenChange} onCreated={onCreated} />,
  );
  return { onOpenChange, onCreated };
}

beforeEach(() => {
  mocks.denied = new Set();
  mocks.product = { isLoading: false, isError: false, data: product() };
  mocks.categories = [];
  mocks.brands = [];
  mocks.catalogsEnabled = [];
  mocks.update.mockReset();
  mocks.create.mockReset();
  mocks.archive.mockReset();
  mocks.reactivate.mockReset();
});

describe("ProductDialog — edit", () => {
  it("opens the item as a popup with its form and a Save in the footer", () => {
    open("p1");
    const dialog = screen.getByRole("dialog", { name: "Edit item" });
    expect(field("name").value).toBe("Deadbolt");
    const save = within(dialog).getByRole("button", { name: "Save" });
    // The one yellow action on the popup.
    expect(save).toHaveAttribute("data-variant", "default");
  });

  it("is wide enough for the form and its side rail", () => {
    open("p1");
    expect(screen.getByRole("dialog").className).toMatch(/sm:max-w-5xl/);
    expect(screen.getByText("Photo panel")).toBeInTheDocument();
    expect(screen.getByText("Pricing")).toBeInTheDocument();
  });

  it("sends only the fields that changed, then closes", async () => {
    const { onOpenChange } = open("p1");
    await userEvent.clear(field("supplier"));
    await userEvent.type(field("supplier"), "Acme");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(mocks.update).toHaveBeenCalledTimes(1));
    expect(mocks.update).toHaveBeenCalledWith({ id: "p1", body: { supplier: "Acme" } });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("closes without a request when nothing changed", async () => {
    const { onOpenChange } = open("p1");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("shows a loading state inside the popup", () => {
    mocks.product = { isLoading: true, isError: false, data: undefined };
    open("p1");
    expect(within(screen.getByRole("dialog")).getByTestId("product-dialog-loading")).toBeInTheDocument();
  });

  it("says so inside the popup when the item is gone", () => {
    mocks.product = { isLoading: false, isError: true, data: undefined };
    open("missing");
    const dialog = screen.getByRole("dialog", { name: "Item not found" });
    expect(dialog).toHaveAccessibleDescription("It may have been deleted.");
    expect(within(dialog).queryByRole("button", { name: "Save" })).toBeNull();
  });

  it("is read-only without products.edit — disabled fields, no Save, no photo", () => {
    mocks.denied = new Set(["products.edit"]);
    open("p1");
    expect(screen.getByRole("dialog", { name: "Item" })).toBeInTheDocument();
    expect(field("name")).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
    expect(screen.queryByText("Photo panel")).toBeNull();
  });

  it("keeps money out of sight without financials.view", () => {
    mocks.denied = new Set(["financials.view"]);
    open("p1");
    expect(screen.queryByText("Company cost")).toBeNull();
    expect(screen.queryByText("$10.00")).toBeNull();
  });

  it("archives after the confirm (products.delete)", async () => {
    const { onOpenChange } = open("p1");
    await userEvent.click(screen.getByRole("button", { name: "Archive" }));
    const confirm = await screen.findByRole("alertdialog");
    await userEvent.click(within(confirm).getByRole("button", { name: "Archive" }));
    expect(mocks.archive).toHaveBeenCalledWith("p1");
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("offers no Archive without products.delete", () => {
    mocks.denied = new Set(["products.delete"]);
    open("p1");
    expect(screen.queryByRole("button", { name: "Archive" })).toBeNull();
  });

  it("restores an archived item", async () => {
    mocks.product = {
      isLoading: false,
      isError: false,
      data: product({ status: InventoryStatus.ARCHIVED }),
    };
    open("p1");
    await userEvent.click(screen.getByRole("button", { name: "Restore" }));
    expect(mocks.reactivate).toHaveBeenCalledWith("p1");
  });

  it("feeds Category and Brand from their catalogs, each behind its own permission", async () => {
    mocks.categories = [
      { id: "c1", name: "Locks", active: true, createdBy: "", createdAt: "", updatedAt: "" },
      { id: "c2", name: "Keys", active: true, createdBy: "", createdAt: "", updatedAt: "" },
    ];
    mocks.brands = [
      { id: "b1", name: "Schlage", active: true, createdBy: "", createdAt: "", updatedAt: "" },
    ];
    mocks.denied = new Set(["brands.view"]);
    open("p1");
    expect(screen.getByRole("combobox", { name: "Category" })).toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "Brand" })).toBeNull();
    expect(mocks.catalogsEnabled).toContainEqual(["categories", true]);
    expect(mocks.catalogsEnabled).toContainEqual(["brands", false]);
  });
});

describe("ProductDialog — create", () => {
  async function fill() {
    await userEvent.type(field("name"), "Keypad lock");
    await userEvent.type(field("sku"), "KP-1");
    await userEvent.type(field("category"), "Locks");
  }

  it("opens a New item popup that tracks stock by default", async () => {
    open(null);
    expect(screen.getByRole("dialog", { name: "New item" })).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Track stock" })).toBeChecked();
    expect(screen.queryByText("Photo panel")).toBeNull();
  });

  it("creates a stock-managed item and hands it back", async () => {
    const { onCreated } = open(null);
    await fill();
    await userEvent.click(screen.getByRole("button", { name: "Create item" }));

    await waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(1));
    expect(mocks.create.mock.calls[0][0]).toMatchObject({
      name: "Keypad lock",
      sku: "KP-1",
      category: "Locks",
      manageStock: true,
    });
    expect(onCreated).toHaveBeenCalledWith(expect.objectContaining({ id: "new-1" }));
  });

  it("refuses without products.create", () => {
    mocks.denied = new Set(["products.create"]);
    open(null);
    expect(screen.getByText(/permission to create items/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Create item" })).toBeNull();
  });
});
