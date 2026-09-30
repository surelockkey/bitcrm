import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { InventoryStatus, ProductType } from "@bitcrm/types";
import type { Product, ProductCategory } from "@bitcrm/types";
import { renderWithClient } from "@/test/render-with-client";
import type { ProductFilter } from "../lib";

const mocks = vi.hoisted(() => ({
  filters: [] as ProductFilter[],
  countFilters: [] as ProductFilter[],
  products: [] as Product[],
  categories: [] as ProductCategory[],
  categoriesEnabled: [] as boolean[],
  denied: new Set<string>(),
  params: new URLSearchParams(),
  push: vi.fn(),
  replace: vi.fn(),
  csv: vi.fn<(...args: unknown[]) => string>(() => "csv"),
  permsLoading: false,
  list: { isLoading: false, isPlaceholderData: false, noData: false },
  catalogLoading: false,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push, replace: mocks.replace }),
  useSearchParams: () => mocks.params,
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
      isPlaceholderData: mocks.list.isPlaceholderData,
      isError: false,
      fetchNextPage: vi.fn(),
      refetch: vi.fn(),
    };
  },
  useProductsCount: (filter: ProductFilter) => {
    mocks.countFilters.push(filter);
    return { data: { total: mocks.products.length, atLeast: false } };
  },
  useItemCategories: (enabled: boolean) => {
    mocks.categoriesEnabled.push(enabled);
    return {
      data: enabled && !mocks.catalogLoading ? mocks.categories : undefined,
      isLoading: enabled && mocks.catalogLoading,
    };
  },
  useArchiveProduct: () => ({ mutate: vi.fn(), isPending: false }),
  useReactivateProduct: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock("../lib", async (original) => ({
  ...(await original<typeof import("../lib")>()),
  productsToCsv: mocks.csv,
}));
vi.mock("./import-products-dialog", () => ({ ImportProductsDialog: () => null }));
// The popups have suites of their own; here only which one the URL opens matters.
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
  ManageStockDialog: (props: {
    productId: string;
    open: boolean;
    onOpenChange: (open: boolean) => void;
  }) =>
    props.open ? (
      <div data-testid="manage-stock-dialog" data-product-id={props.productId}>
        <button onClick={() => props.onOpenChange(false)}>close stock</button>
      </div>
    ) : null,
}));

import { ProductsPage } from "./products-page";

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

function category(name: string, active = true): ProductCategory {
  return { id: name, name, active, createdBy: "", createdAt: "", updatedAt: "" };
}

const noScroll = { scroll: false };

beforeEach(() => {
  mocks.filters = [];
  mocks.countFilters = [];
  mocks.products = [product()];
  mocks.categories = [category("Locks"), category("Keys"), category("Retired", false)];
  mocks.categoriesEnabled = [];
  mocks.denied = new Set();
  mocks.params = new URLSearchParams();
  mocks.push.mockReset();
  mocks.replace.mockReset();
  mocks.csv.mockClear();
  mocks.permsLoading = false;
  mocks.list = { isLoading: false, isPlaceholderData: false, noData: false };
  mocks.catalogLoading = false;
});

describe("ProductsPage — stock-managed items only, filters on the server", () => {
  it("asks for stock-managed items only, in the list and in its count", () => {
    renderWithClient(<ProductsPage />);
    expect(mocks.filters.at(-1)).toMatchObject({ manageStock: true, status: InventoryStatus.ACTIVE });
    expect(mocks.countFilters.at(-1)).toEqual(mocks.filters.at(-1));
  });

  it("has no Type filter — services are never stock-managed", () => {
    renderWithClient(<ProductsPage />);
    expect(screen.queryByRole("combobox", { name: "Type" })).toBeNull();
  });

  it("sends the search after a pause, not on every keystroke", async () => {
    renderWithClient(<ProductsPage />);
    await userEvent.type(screen.getByPlaceholderText("Search name or SKU"), "dead");
    await waitFor(() => expect(mocks.filters.at(-1)).toMatchObject({ search: "dead" }));
    expect(mocks.filters.some((f) => f.search === "de")).toBe(false);
    expect(mocks.filters.at(-1)).toMatchObject({ manageStock: true });
  });

  it("offers every catalog category (sorted), not just the ones on this page", async () => {
    renderWithClient(<ProductsPage />);
    await userEvent.click(screen.getByRole("combobox", { name: "Category" }));
    const names = (await screen.findAllByRole("option")).map((o) => o.textContent);
    expect(names).toEqual(["All categories", "Keys", "Locks", "Retired"]);
  });

  it("combines the category with the status", async () => {
    renderWithClient(<ProductsPage />);
    await userEvent.click(screen.getByRole("combobox", { name: "Category" }));
    await userEvent.click(await screen.findByRole("option", { name: "Keys" }));
    await userEvent.click(screen.getByRole("combobox", { name: "Status" }));
    await userEvent.click(await screen.findByRole("option", { name: "Archived" }));
    expect(mocks.filters.at(-1)).toMatchObject({
      manageStock: true,
      category: "Keys",
      status: InventoryStatus.ARCHIVED,
    });
  });

  it("drops the status for All", async () => {
    renderWithClient(<ProductsPage />);
    await userEvent.click(screen.getByRole("combobox", { name: "Status" }));
    await userEvent.click(await screen.findByRole("option", { name: "All statuses" }));
    expect(mocks.filters.at(-1)?.status).toBeUndefined();
  });

  it("reads the categories only with product_categories.view, and then shows no Category filter", () => {
    mocks.denied = new Set(["product_categories.view"]);
    renderWithClient(<ProductsPage />);
    expect(mocks.categoriesEnabled.at(-1)).toBe(false);
    expect(screen.queryByRole("combobox", { name: "Category" })).toBeNull();
  });

  it("shows Cost only with financials.view", () => {
    mocks.denied = new Set(["financials.view"]);
    renderWithClient(<ProductsPage />);
    expect(screen.getByRole("columnheader", { name: "Price" })).toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: "Cost" })).toBeNull();
  });
});

describe("ProductsPage — popups are driven by the URL", () => {
  it("opens the Edit popup for ?edit=<id>", () => {
    mocks.params = new URLSearchParams("edit=p9");
    renderWithClient(<ProductsPage />);
    expect(screen.getByTestId("product-dialog")).toHaveAttribute("data-product-id", "p9");
    expect(screen.queryByTestId("manage-stock-dialog")).toBeNull();
  });

  it("opens the New item popup for ?new=1", () => {
    mocks.params = new URLSearchParams("new=1");
    renderWithClient(<ProductsPage />);
    expect(screen.getByTestId("product-dialog")).toHaveAttribute("data-product-id", "new");
  });

  it("opens Manage stock for ?stock=<id>", () => {
    mocks.params = new URLSearchParams("stock=p9");
    renderWithClient(<ProductsPage />);
    expect(screen.getByTestId("manage-stock-dialog")).toHaveAttribute("data-product-id", "p9");
    expect(screen.queryByTestId("product-dialog")).toBeNull();
  });

  it("opens nothing without a param", () => {
    renderWithClient(<ProductsPage />);
    expect(screen.queryByTestId("product-dialog")).toBeNull();
    expect(screen.queryByTestId("manage-stock-dialog")).toBeNull();
  });

  it("puts ?edit=<id> in the URL from the row's Edit button", async () => {
    renderWithClient(<ProductsPage />);
    await userEvent.click(screen.getByRole("button", { name: "Edit Deadbolt" }));
    expect(mocks.push).toHaveBeenCalledWith("/inventory/items?edit=p1", noScroll);
  });

  it("puts ?stock=<id> in the URL from the row's Stock button", async () => {
    renderWithClient(<ProductsPage />);
    await userEvent.click(screen.getByRole("button", { name: "Manage stock for Deadbolt" }));
    expect(mocks.push).toHaveBeenCalledWith("/inventory/items?stock=p1", noScroll);
  });

  it("puts ?new=1 in the URL from New item", async () => {
    renderWithClient(<ProductsPage />);
    await userEvent.click(screen.getByRole("button", { name: "New item" }));
    expect(mocks.push).toHaveBeenCalledWith("/inventory/items?new=1", noScroll);
  });

  it("clears the param when a popup closes", async () => {
    mocks.params = new URLSearchParams("stock=p9");
    renderWithClient(<ProductsPage />);
    await userEvent.click(screen.getByRole("button", { name: "close stock" }));
    expect(mocks.replace).toHaveBeenCalledWith("/inventory/items", noScroll);
  });

  it("moves a just-created item into its Edit popup (photo, stock)", async () => {
    mocks.params = new URLSearchParams("new=1");
    renderWithClient(<ProductsPage />);
    await userEvent.click(screen.getByRole("button", { name: "created" }));
    expect(mocks.replace).toHaveBeenCalledWith("/inventory/items?edit=new-1", noScroll);
  });
});

describe("ProductsPage — toolbar", () => {
  beforeEach(() => {
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    URL.createObjectURL = vi.fn(() => "blob:items");
    URL.revokeObjectURL = vi.fn();
  });
  afterEach(() => vi.restoreAllMocks());

  it("exports the rows on screen, with the company cost", async () => {
    renderWithClient(<ProductsPage />);
    await userEvent.click(screen.getByRole("button", { name: /Export CSV/ }));
    expect(mocks.csv).toHaveBeenCalledWith(mocks.products, { withCost: true });
  });

  it("leaves the company cost out of the export without financials.view", async () => {
    mocks.denied = new Set(["financials.view"]);
    renderWithClient(<ProductsPage />);
    await userEvent.click(screen.getByRole("button", { name: /Export CSV/ }));
    expect(mocks.csv).toHaveBeenCalledWith(mocks.products, { withCost: false });
  });

  it("has no bulk selection", () => {
    renderWithClient(<ProductsPage />);
    expect(screen.queryByRole("checkbox")).toBeNull();
  });
});

/**
 * "Nothing jumps": the first frame is the table itself; a new search keeps
 * the rows; the toolbar and the columns are all there before the permissions
 * and the categories answer.
 */
describe("ProductsPage — a stable first frame", () => {
  const headers = () => [...document.querySelectorAll("thead th")].map((th) => th.getAttribute("aria-label"));

  it("draws the real table while the first page loads, with the pager's space held", () => {
    mocks.list = { isLoading: true, isPlaceholderData: false, noData: true };
    renderWithClient(<ProductsPage />);

    expect(headers()).toContain("Name");
    expect(screen.getAllByTestId("skeleton-row").length).toBeGreaterThan(0);
    expect(screen.getByTestId("list-pagination")).toHaveAttribute("aria-busy", "true");
  });

  it("keeps the rows on screen, dimmed, while a new search loads", () => {
    mocks.list = { isLoading: false, isPlaceholderData: true, noData: false };
    renderWithClient(<ProductsPage />);

    expect(screen.getByText("Deadbolt")).toBeInTheDocument();
    expect(screen.queryByTestId("skeleton-row")).toBeNull();
    expect(screen.getByRole("table")).toHaveAttribute("aria-busy", "true");
  });

  it("never flashes No access while permissions are still loading", () => {
    mocks.permsLoading = true;
    renderWithClient(<ProductsPage />);
    expect(screen.queryByText("No access")).toBeNull();
    expect(screen.getByRole("table")).toBeInTheDocument();
  });

  it("says No access once it is known", () => {
    mocks.denied = new Set(["products.view"]);
    renderWithClient(<ProductsPage />);
    expect(screen.getByText("No access")).toBeInTheDocument();
  });

  // Appearing with the permissions, Cost shifted every column after it.
  it("keeps the Cost column while permissions load — its cells wait, they don't show money", () => {
    mocks.permsLoading = true;
    renderWithClient(<ProductsPage />);
    expect(headers()).toContain("Cost");
    expect(screen.queryByText("$10.00")).toBeNull();
  });

  it("holds Import and New item in the toolbar, disabled, until permissions are known", () => {
    mocks.permsLoading = true;
    renderWithClient(<ProductsPage />);
    expect(screen.getByRole("button", { name: /Import CSV/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /New item/ })).toBeDisabled();
  });

  // The categories waited for /users/me: two requests in a row before the
  // toolbar was whole. The server guards the catalog, so it is asked for at
  // once; the Category select still shows only with product_categories.view.
  it("asks for the items and the categories while the permissions load", () => {
    mocks.permsLoading = true;
    renderWithClient(<ProductsPage />);
    expect(mocks.filters.length).toBeGreaterThan(0);
    expect(mocks.categoriesEnabled[0]).toBe(true);
  });

  // Appearing with the catalog, the Category select pushed Status and the
  // buttons sideways (and on a phone wrapped the toolbar onto a new line).
  it("has the Category select from the first frame, disabled until the categories arrive", () => {
    mocks.catalogLoading = true;
    renderWithClient(<ProductsPage />);
    expect(screen.getByRole("combobox", { name: "Category" })).toBeDisabled();
  });
});
