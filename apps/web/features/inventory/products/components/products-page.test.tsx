import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { InventoryStatus, ProductType } from "@bitcrm/types";
import type { Brand, ItemAttribute, Product, ProductCategory } from "@bitcrm/types";
import { renderWithClient } from "@/test/render-with-client";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { ProductFilter } from "../lib";

const mocks = vi.hoisted(() => ({
  filters: [] as ProductFilter[],
  countFilters: [] as ProductFilter[],
  products: [] as Product[],
  categories: [] as ProductCategory[],
  brands: [] as Brand[],
  attributes: [] as ItemAttribute[],
  categoriesEnabled: [] as boolean[],
  denied: new Set<string>(),
  push: vi.fn(),
  replace: vi.fn(),
  csv: vi.fn<(...args: unknown[]) => string>(() => "csv"),
  permsLoading: false,
  list: { isLoading: false, isPlaceholderData: false, noData: false },
  catalogLoading: false,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push, replace: mocks.replace }),
  usePathname: () => "/inventory/items",
}));
vi.mock("@/features/auth/use-permissions", () => ({
  useDenied: () => (resource: string, action = "view") =>
    !mocks.permsLoading && mocks.denied.has(`${resource}.${action}`),
  usePermissions: () => ({
    can: (resource: string, action = "view") =>
      !mocks.permsLoading && !mocks.denied.has(`${resource}.${action}`),
    isLoading: mocks.permsLoading,
  }),
}));
vi.mock("../hooks", () => ({
  useProducts: (filter: ProductFilter) => {
    mocks.filters.push(filter);
    return {
      data: mocks.list.noData ? undefined : { pages: [{ data: mocks.products, pagination: {} }] },
      hasNextPage: false,
      isFetchingNextPage: false,
      isLoading: mocks.list.isLoading,
      isPending: mocks.list.isLoading,
      fetchStatus: mocks.list.isLoading ? "fetching" : "idle",
      isPlaceholderData: mocks.list.isPlaceholderData,
      isError: false,
      fetchNextPage: vi.fn(),
      refetch: vi.fn(),
    };
  },
  useProductsCount: (filter: ProductFilter) => {
    mocks.countFilters.push(filter);
    return { data: { total: mocks.products.length, atLeast: false }, isError: false, isPending: false, fetchStatus: "idle" };
  },
  useItemCategories: (enabled: boolean) => {
    mocks.categoriesEnabled.push(enabled);
    return {
      data: enabled && !mocks.catalogLoading ? mocks.categories : undefined,
      isLoading: enabled && mocks.catalogLoading,
      isError: false,
      isPending: !enabled || mocks.catalogLoading,
      fetchStatus: enabled && mocks.catalogLoading ? "fetching" : "idle",
    };
  },
  useBrands: () => ({ data: mocks.brands, isError: false, isPending: false, fetchStatus: "idle" }),
}));
vi.mock("@/features/inventory/item-attributes/hooks", () => ({
  useItemAttributes: () => ({ data: mocks.attributes, isError: false, isPending: false, fetchStatus: "idle" }),
}));
vi.mock("../lib", async (original) => ({
  ...(await original<typeof import("../lib")>()),
  productsToCsv: mocks.csv,
}));
vi.mock("./import-products-dialog", () => ({ ImportProductsDialog: () => null }));
// The popups have suites of their own; here only which one opens matters.
vi.mock("./product-dialog", () => ({
  ProductDialog: (props: {
    productId: string | null;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onCreated: (p: Product) => void;
  }) =>
    props.open ? (
      <div data-testid="product-dialog" data-product-id={props.productId ?? "new"}>
        <button onClick={() => props.onOpenChange(false)}>close popup</button>
        <button onClick={() => props.onCreated({ id: "new-1" } as Product)}>created</button>
      </div>
    ) : null,
}));
vi.mock("@/features/inventory/stock/components/manage-stock-dialog", () => ({
  ManageStockDialog: (props: { productId: string; open: boolean; onOpenChange: (open: boolean) => void }) =>
    props.open ? (
      <div data-testid="manage-stock-dialog" data-product-id={props.productId}>
        <button onClick={() => props.onOpenChange(false)}>close stock</button>
      </div>
    ) : null,
}));

import { ProductsPage } from "./products-page";

const render = () =>
  renderWithClient(
    <TooltipProvider>
      <ProductsPage />
    </TooltipProvider>,
  );

function product(over: Partial<Product> = {}): Product {
  return {
    id: "p1",
    number: 7,
    sku: "LOCK-001",
    name: "Deadbolt",
    category: "Locks",
    type: ProductType.PRODUCT,
    costCompany: 10,
    costTech: 18,
    priceClient: 45,
    serialTracking: false,
    minimumStockLevel: 5,
    onHand: 3,
    status: InventoryStatus.ACTIVE,
    createdAt: "",
    updatedAt: "",
    ...over,
  };
}

function category(name: string, externalId: string, active = true) {
  return { id: name, name, active, externalId, createdBy: "", createdAt: "", updatedAt: "" } as ProductCategory;
}

/** Opens a Workiz box (react-select) by its name and picks an option. */
async function pick(box: string, option: string) {
  await userEvent.click(screen.getByRole("combobox", { name: box }));
  await userEvent.click(await screen.findByRole("option", { name: option }));
}

beforeEach(() => {
  mocks.filters = [];
  mocks.countFilters = [];
  mocks.products = [product()];
  // Workiz lists its categories by its own ids, not by name.
  mocks.categories = [category("Locks", "workiz:category:1"), category("Keys", "workiz:category:3"), category("Door Hardware", "workiz:category:2")];
  mocks.brands = [{ id: "b-slk", name: "SLK", active: true, createdAt: "", updatedAt: "" } as Brand];
  mocks.attributes = [];
  mocks.categoriesEnabled = [];
  mocks.denied = new Set();
  mocks.push.mockReset();
  mocks.replace.mockReset();
  mocks.csv.mockClear();
  mocks.permsLoading = false;
  mocks.list = { isLoading: false, isPlaceholderData: false, noData: false };
  mocks.catalogLoading = false;
});

/**
 * Workiz's Inventory tab (pg_inventory_wz_01_inventory): All brands / All
 * categories / All Stock Levels over the grid, BitCRM's status box beside
 * them; every filter goes to the server.
 */
describe("ProductsPage — Workiz's boxes, filtered on the server", () => {
  it("asks for the active stock-managed items, in the list and in its count", () => {
    render();
    expect(mocks.filters.at(-1)).toEqual({ manageStock: true, status: InventoryStatus.ACTIVE });
    expect(mocks.countFilters.at(-1)).toEqual(mocks.filters.at(-1));
  });

  it("draws Workiz's three boxes and ours, each on its All", () => {
    render();
    expect(screen.getByRole("combobox", { name: "Brand" })).toBeInTheDocument();
    expect(screen.getByText("All brands")).toBeInTheDocument();
    expect(screen.getByText("All categories")).toBeInTheDocument();
    expect(screen.getByText("All Stock Levels")).toBeInTheDocument();
    expect(screen.getByText("Active items")).toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "Type" })).toBeNull();
  });

  it("sends the search after a pause, not on every keystroke", async () => {
    render();
    await userEvent.type(screen.getByPlaceholderText("Search"), "dead");
    await waitFor(() => expect(mocks.filters.at(-1)).toMatchObject({ search: "dead" }));
    expect(mocks.filters.some((f) => f.search === "de")).toBe(false);
    expect(mocks.filters.at(-1)).toMatchObject({ manageStock: true });
  });

  it("lists the catalog's categories in Workiz's order", async () => {
    render();
    await userEvent.click(screen.getByRole("combobox", { name: "Category" }));
    const list = await screen.findByRole("listbox");
    const names = within(list).getAllByRole("option").map((o) => o.textContent);
    expect(names).toEqual(["All categories", "Locks", "Door Hardware", "Keys"]);
  });

  it("combines the brand, the category, the stock level and the status", async () => {
    render();
    await pick("Brand", "SLK");
    await pick("Category", "Keys");
    await pick("Stock level", "Low Stock");
    await pick("Status", "Disabled items");
    expect(mocks.filters.at(-1)).toEqual({
      manageStock: true,
      brandId: "b-slk",
      category: "Keys",
      stockLevel: "low",
      status: InventoryStatus.ARCHIVED,
    });
  });

  it("asks for Stocked, and drops the status for All items", async () => {
    render();
    await pick("Stock level", "Stocked");
    await pick("Status", "All items");
    expect(mocks.filters.at(-1)).toEqual({ manageStock: true, stockLevel: "stocked" });
  });

  it("reads the categories only with product_categories.view, and then shows no Category box", () => {
    mocks.denied = new Set(["product_categories.view"]);
    render();
    expect(mocks.categoriesEnabled.at(-1)).toBe(false);
    expect(screen.queryByRole("combobox", { name: "Category" })).toBeNull();
  });

  it("shows Cost only with financials.view", () => {
    mocks.denied = new Set(["financials.view"]);
    render();
    expect(screen.getByRole("columnheader", { name: "Price" })).toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: "Cost" })).toBeNull();
  });

  it("gives every item custom field a column after Brand", () => {
    mocks.attributes = [{ id: "a1", name: "ALL SKU", type: "text", visible: false, resource: "items" }];
    render();
    expect(screen.getByRole("columnheader", { name: "ALL SKU" })).toBeInTheDocument();
  });
});

/**
 * The owner's rule: a popup is the page's state, never the address — and no
 * address opens one: an old link with the popup in its query lands on the
 * plain list.
 */
describe("ProductsPage — popups are state, not the URL", () => {
  const address = () => `${window.location.pathname}${window.location.search}`;
  beforeEach(() => window.history.replaceState(null, "", "/inventory/items"));

  it("opens the Edit popup from the row's pencil, the address untouched", async () => {
    render();
    await userEvent.click(screen.getByRole("button", { name: "Edit Deadbolt" }));
    expect(screen.getByTestId("product-dialog")).toHaveAttribute("data-product-id", "p1");
    expect(address()).toBe("/inventory/items");
    expect(mocks.push).not.toHaveBeenCalled();
    expect(mocks.replace).not.toHaveBeenCalled();
  });

  it("opens Manage stock from the row's box", async () => {
    render();
    await userEvent.click(screen.getByRole("button", { name: "Manage stock for Deadbolt" }));
    expect(screen.getByTestId("manage-stock-dialog")).toHaveAttribute("data-product-id", "p1");
    expect(screen.queryByTestId("product-dialog")).toBeNull();
    expect(address()).toBe("/inventory/items");
  });

  it("opens the new-item popup from Add New", async () => {
    render();
    await userEvent.click(screen.getByRole("button", { name: "Add New" }));
    expect(screen.getByTestId("product-dialog")).toHaveAttribute("data-product-id", "new");
    expect(address()).toBe("/inventory/items");
  });

  it("opens nothing by itself", () => {
    render();
    expect(screen.queryByTestId("product-dialog")).toBeNull();
    expect(screen.queryByTestId("manage-stock-dialog")).toBeNull();
  });

  it("closes a popup back to the list", async () => {
    render();
    await userEvent.click(screen.getByRole("button", { name: "Manage stock for Deadbolt" }));
    await userEvent.click(screen.getByRole("button", { name: "close stock" }));
    expect(screen.queryByTestId("manage-stock-dialog")).toBeNull();
    expect(address()).toBe("/inventory/items");
  });

  it("moves a just-created item into its Edit popup (photo, stock)", async () => {
    render();
    await userEvent.click(screen.getByRole("button", { name: "Add New" }));
    await userEvent.click(screen.getByRole("button", { name: "created" }));
    expect(screen.getByTestId("product-dialog")).toHaveAttribute("data-product-id", "new-1");
  });

  it.each(["edit=p9", "stock=p9", "new=1"])("opens nothing from an old ?%s link, and takes it out of the address", (query) => {
    window.history.replaceState(null, "", `/inventory/items?${query}`);
    render();
    expect(screen.queryByTestId("product-dialog")).toBeNull();
    expect(screen.queryByTestId("manage-stock-dialog")).toBeNull();
    expect(address()).toBe("/inventory/items");
  });
});

describe("ProductsPage — the strip", () => {
  beforeEach(() => {
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    URL.createObjectURL = vi.fn(() => "blob:items");
    URL.revokeObjectURL = vi.fn();
  });
  afterEach(() => vi.restoreAllMocks());

  it("exports the rows on screen, with the company cost", async () => {
    render();
    await userEvent.click(screen.getByRole("button", { name: /Export/ }));
    expect(mocks.csv).toHaveBeenCalledWith(mocks.products, { withCost: true });
  });

  it("leaves the company cost out of the export without financials.view", async () => {
    mocks.denied = new Set(["financials.view"]);
    render();
    await userEvent.click(screen.getByRole("button", { name: /Export/ }));
    expect(mocks.csv).toHaveBeenCalledWith(mocks.products, { withCost: false });
  });

  it("has Workiz's page sizes, ten to start with", () => {
    render();
    const size = screen.getByRole("combobox", { name: /rows per page|page size/i }) as HTMLSelectElement;
    expect(size.value).toBe("10");
  });

  it("has no bulk selection", () => {
    render();
    expect(screen.queryByRole("checkbox")).toBeNull();
  });
});

/**
 * "Nothing jumps": one loader, then the page whole; a new search keeps the
 * rows; the boxes and the columns are all there before the permissions and
 * the catalogs answer.
 */
describe("ProductsPage — a stable first frame", () => {
  const headers = () => [...document.querySelectorAll("thead th")].map((th) => th.textContent?.trim());

  it("draws the pager inside the grid, with the rows", () => {
    render();
    const grid = document.querySelector("[data-slot=wz-report-grid]")!;
    expect(grid).toHaveTextContent("Showing 1 to 1 of 1 results");
  });

  it("draws the grid's header over Workiz's loader while the first page loads, no pager", () => {
    mocks.list = { isLoading: true, isPlaceholderData: false, noData: true };
    render();
    expect(headers()).toContain("Name");
    expect(screen.getByRole("status", { name: "Loading" })).toBeInTheDocument();
    expect(screen.queryByText(/Showing/)).toBeNull();
  });

  it("keeps the rows on screen, dimmed, while a new search loads", () => {
    mocks.list = { isLoading: false, isPlaceholderData: true, noData: false };
    render();
    expect(screen.getByText("Deadbolt")).toBeInTheDocument();
    expect(document.querySelector("[data-slot=wz-report-grid]")).toHaveAttribute("aria-busy", "true");
  });

  it("never flashes No access while permissions are still loading", () => {
    mocks.permsLoading = true;
    render();
    expect(screen.queryByText("No access")).toBeNull();
    expect(screen.getByRole("table")).toBeInTheDocument();
  });

  it("says No access once it is known", () => {
    mocks.denied = new Set(["products.view"]);
    render();
    expect(screen.getByText("No access")).toBeInTheDocument();
  });

  // Appearing with the permissions, Cost shifted every column after it.
  it("keeps the Cost column while permissions load", () => {
    mocks.permsLoading = true;
    render();
    expect(headers()).toContain("Cost");
  });

  it("holds Import and Add New, disabled, until permissions are known", () => {
    mocks.permsLoading = true;
    render();
    expect(screen.getByRole("button", { name: /Import/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Add New/ })).toBeDisabled();
  });

  // The categories waited for /users/me: two requests in a row before the
  // boxes were whole. The server guards the catalog, so it is asked at once.
  it("asks for the items and the categories while the permissions load", () => {
    mocks.permsLoading = true;
    render();
    expect(mocks.filters.length).toBeGreaterThan(0);
    expect(mocks.categoriesEnabled[0]).toBe(true);
  });
});
