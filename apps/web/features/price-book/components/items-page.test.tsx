import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { InventoryStatus, ProductType } from "@bitcrm/types";
import type { Brand, Product, ProductCategory } from "@bitcrm/types";
import { renderWithClient } from "@/test/render-with-client";
import type { ProductFilter } from "@/features/inventory/products/lib";

const mocks = vi.hoisted(() => ({
  filters: [] as ProductFilter[],
  limits: [] as number[],
  countFilters: [] as ProductFilter[],
  resetKeys: [] as (string | undefined)[],
  items: [] as Product[],
  loading: false,
  placeholder: false,
  categories: [] as ProductCategory[],
  brands: [] as Brand[],
  categoriesEnabled: [] as boolean[],
  brandsEnabled: [] as boolean[],
  denied: new Set<string>(),
  params: new URLSearchParams(),
  push: vi.fn(),
  replace: vi.fn(),
  csv: vi.fn<(...args: unknown[]) => string>(() => "csv"),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push, replace: mocks.replace }),
  useSearchParams: () => mocks.params,
  usePathname: () => "/price-book/items",
}));
vi.mock("@/features/auth/use-permissions", () => ({
  useDenied: () => (resource: string, action = "view") => mocks.denied.has(`${resource}.${action}`),
  usePermissions: () => ({
    can: (resource: string, action = "view") => !mocks.denied.has(`${resource}.${action}`),
  }),
}));
vi.mock("../hooks", () => ({
  usePriceBookItems: (filter: ProductFilter, limit: number) => {
    mocks.filters.push(filter);
    mocks.limits.push(limit);
    return {
      data: mocks.loading ? undefined : { pages: [{ data: mocks.items, pagination: {} }] },
      hasNextPage: mocks.placeholder,
      isFetchingNextPage: false,
      isLoading: mocks.loading,
      isError: false,
      isPlaceholderData: mocks.placeholder,
      fetchNextPage: vi.fn(),
      refetch: vi.fn(),
    };
  },
  usePriceBookCount: (filter: ProductFilter) => {
    mocks.countFilters.push(filter);
    return { data: mocks.loading ? undefined : { total: mocks.items.length, atLeast: false } };
  },
}));
vi.mock("@/features/inventory/products/hooks", () => ({
  useItemCategories: (enabled: boolean) => {
    mocks.categoriesEnabled.push(enabled);
    return { data: enabled ? mocks.categories : undefined };
  },
  useBrands: (enabled: boolean) => {
    mocks.brandsEnabled.push(enabled);
    return { data: enabled ? mocks.brands : undefined };
  },
  useArchiveProduct: () => ({ mutate: vi.fn(), isPending: false }),
  useReactivateProduct: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock("@/features/inventory/products/lib", async (original) => ({
  ...(await original<typeof import("@/features/inventory/products/lib")>()),
  productsToCsv: mocks.csv,
}));
vi.mock("@/lib/paging/use-pager", async (original) => {
  const real = await original<typeof import("@/lib/paging/use-pager")>();
  return {
    ...real,
    usePager: (src: Parameters<typeof real.usePager>[0], opts: Parameters<typeof real.usePager>[1]) => {
      mocks.resetKeys.push(opts.resetKey);
      return real.usePager(src, opts);
    },
  };
});
vi.mock("@/features/inventory/products/components/import-products-dialog", () => ({
  ImportProductsDialog: (props: { open: boolean }) =>
    props.open ? <div data-testid="import-dialog" /> : null,
}));
// The popup has a suite of its own; here only which one the URL opens matters.
vi.mock("@/features/inventory/products/components/product-dialog", () => ({
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

import { ItemsPage } from "./items-page";

function product(over: Partial<Product> = {}): Product {
  return {
    id: "p1",
    number: 7,
    sku: "LOCK-001",
    name: "Deadbolt",
    category: "Locks",
    type: ProductType.PRODUCT,
    brandId: "b1",
    costCompany: 10,
    costTech: 18,
    priceClient: 45,
    serialTracking: false,
    minimumStockLevel: 5,
    status: InventoryStatus.ACTIVE,
    createdAt: "",
    updatedAt: "",
    ...over,
  };
}

const row = (id: string, name: string, active = true) => ({
  id,
  name,
  active,
  createdBy: "",
  createdAt: "",
  updatedAt: "",
});

const noScroll = { scroll: false };

async function pick(combobox: string, option: string) {
  await userEvent.click(screen.getByRole("combobox", { name: combobox }));
  await userEvent.click(await screen.findByRole("option", { name: option }));
}

beforeEach(() => {
  mocks.filters = [];
  mocks.limits = [];
  mocks.countFilters = [];
  mocks.resetKeys = [];
  mocks.items = [product(), product({ id: "s1", name: "Rekey", sku: "SVC-1", type: ProductType.SERVICE, brandId: undefined })];
  mocks.loading = false;
  mocks.placeholder = false;
  mocks.categories = [row("c1", "Locks"), row("c2", "Keys"), row("c3", "Retired", false)];
  mocks.brands = [row("b1", "Schlage"), row("b2", "Kwikset")];
  mocks.categoriesEnabled = [];
  mocks.brandsEnabled = [];
  mocks.denied = new Set();
  mocks.params = new URLSearchParams();
  mocks.push.mockReset();
  mocks.replace.mockReset();
  mocks.csv.mockClear();
});

describe("ItemsPage — the whole catalog, filtered on the server", () => {
  it("starts on active items of every type, stock-managed or not — list and count alike", () => {
    renderWithClient(<ItemsPage />);
    expect(mocks.filters.at(-1)).toEqual({ status: InventoryStatus.ACTIVE });
    expect(mocks.countFilters.at(-1)).toEqual(mocks.filters.at(-1));
  });

  it("filters by type", async () => {
    renderWithClient(<ItemsPage />);
    await pick("Type", "Service");
    expect(mocks.filters.at(-1)).toEqual({ type: ProductType.SERVICE, status: InventoryStatus.ACTIVE });
    await pick("Type", "All types");
    expect(mocks.filters.at(-1)?.type).toBeUndefined();
  });

  it("offers every catalog category by name, sorted, and sends the name", async () => {
    renderWithClient(<ItemsPage />);
    await userEvent.click(screen.getByRole("combobox", { name: "Category" }));
    const names = (await screen.findAllByRole("option")).map((o) => o.textContent);
    expect(names).toEqual(["All categories", "Keys", "Locks", "Retired"]);
    await userEvent.click(screen.getByRole("option", { name: "Keys" }));
    expect(mocks.filters.at(-1)).toMatchObject({ category: "Keys" });
  });

  it("offers the brands by name, sorted, and sends the brand's id", async () => {
    renderWithClient(<ItemsPage />);
    await userEvent.click(screen.getByRole("combobox", { name: "Brand" }));
    const names = (await screen.findAllByRole("option")).map((o) => o.textContent);
    expect(names).toEqual(["All brands", "Kwikset", "Schlage"]);
    await userEvent.click(screen.getByRole("option", { name: "Kwikset" }));
    expect(mocks.filters.at(-1)).toMatchObject({ brandId: "b2" });
  });

  it("filters by status, Active by default, and drops it for All", async () => {
    renderWithClient(<ItemsPage />);
    await pick("Status", "Archived");
    expect(mocks.filters.at(-1)?.status).toBe(InventoryStatus.ARCHIVED);
    await pick("Status", "All statuses");
    expect(mocks.filters.at(-1)?.status).toBeUndefined();
  });

  it("filters by Manage stock: Tracked is true, Not tracked is false", async () => {
    renderWithClient(<ItemsPage />);
    await pick("Manage stock", "Tracked");
    expect(mocks.filters.at(-1)?.manageStock).toBe(true);
    await pick("Manage stock", "Not tracked");
    expect(mocks.filters.at(-1)?.manageStock).toBe(false);
    await pick("Manage stock", "All items");
    expect(mocks.filters.at(-1)?.manageStock).toBeUndefined();
  });

  it("sends the search after a pause, not on every keystroke", async () => {
    renderWithClient(<ItemsPage />);
    await userEvent.type(screen.getByPlaceholderText("Search name or SKU"), "dead");
    await waitFor(() => expect(mocks.filters.at(-1)).toMatchObject({ search: "dead" }));
    expect(mocks.filters.some((f) => f.search === "de")).toBe(false);
  });

  it("combines every filter in one request, and counts under the same", async () => {
    renderWithClient(<ItemsPage />);
    await pick("Type", "Product");
    await pick("Category", "Locks");
    await pick("Brand", "Schlage");
    await pick("Status", "Archived");
    await pick("Manage stock", "Not tracked");
    await userEvent.type(screen.getByPlaceholderText("Search name or SKU"), "bolt");
    const all = {
      search: "bolt",
      type: ProductType.PRODUCT,
      category: "Locks",
      brandId: "b1",
      status: InventoryStatus.ARCHIVED,
      manageStock: false,
    };
    await waitFor(() => expect(mocks.filters.at(-1)).toEqual(all));
    expect(mocks.countFilters.at(-1)).toEqual(all);
  });

  it("puts the filters and the page size in the pager's reset key", async () => {
    renderWithClient(<ItemsPage />);
    const before = mocks.resetKeys.at(-1);
    await pick("Type", "Service");
    const after = mocks.resetKeys.at(-1)!;
    expect(after).not.toBe(before);
    expect(JSON.parse(after)).toEqual({
      filter: { type: ProductType.SERVICE, status: InventoryStatus.ACTIVE },
      pageSize: mocks.limits.at(-1),
    });
  });

  it("reads each catalog only with its view permission, and then drops its filter", () => {
    mocks.denied = new Set(["product_categories.view", "brands.view"]);
    renderWithClient(<ItemsPage />);
    expect(mocks.categoriesEnabled.at(-1)).toBe(false);
    expect(mocks.brandsEnabled.at(-1)).toBe(false);
    expect(screen.queryByRole("combobox", { name: "Category" })).toBeNull();
    expect(screen.queryByRole("combobox", { name: "Brand" })).toBeNull();
  });
});

describe("ItemsPage — the table", () => {
  it("names each item's brand from the brands catalog", () => {
    renderWithClient(<ItemsPage />);
    expect(within(screen.getByRole("table")).getByText("Schlage")).toBeInTheDocument();
  });

  it("shows Cost only with financials.view", () => {
    const { unmount } = renderWithClient(<ItemsPage />);
    expect(screen.getByRole("columnheader", { name: "Cost" })).toBeInTheDocument();
    unmount();
    mocks.denied = new Set(["financials.view"]);
    renderWithClient(<ItemsPage />);
    expect(screen.getByRole("columnheader", { name: "Price" })).toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: "Cost" })).toBeNull();
  });

  it("draws the first load as the table itself, with the pager's room kept", () => {
    mocks.loading = true;
    const { container } = renderWithClient(<ItemsPage />);
    const heads = container.querySelectorAll("thead th").length;
    const skeleton = screen.getAllByTestId("skeleton-row");
    expect(skeleton.length).toBeGreaterThan(0);
    expect(skeleton[0].querySelectorAll("td")).toHaveLength(heads);
    expect(heads).toBe(12);
    expect(screen.getByTestId("pager-slot").className).toMatch(/min-h-/);
  });

  it("keeps the previous filter's rows, dimmed, and does not page through them", () => {
    mocks.placeholder = true;
    const { container } = renderWithClient(<ItemsPage />);
    expect(container.querySelector("table")).toHaveAttribute("aria-busy", "true");
    expect(screen.queryByRole("button", { name: "Next page" })).toBeNull();
  });

  it("says no item matches under a filter, and offers New item on an empty catalog", async () => {
    mocks.items = [];
    const { unmount } = renderWithClient(<ItemsPage />);
    expect(screen.getByText("No items yet")).toBeInTheDocument();
    unmount();
    renderWithClient(<ItemsPage />);
    await pick("Type", "Service");
    expect(screen.getByText("No items match")).toBeInTheDocument();
  });

  it("refuses without products.view", () => {
    mocks.denied = new Set(["products.view"]);
    renderWithClient(<ItemsPage />);
    expect(screen.getByText("No access")).toBeInTheDocument();
    expect(screen.queryByRole("table")).toBeNull();
  });
});

describe("ItemsPage — popups are driven by the URL", () => {
  it("opens the Edit popup on a row click", async () => {
    renderWithClient(<ItemsPage />);
    await userEvent.click(screen.getByText("LOCK-001"));
    expect(mocks.push).toHaveBeenCalledWith("/price-book/items?edit=p1", noScroll);
  });

  it("opens the New item popup from the one yellow button", async () => {
    renderWithClient(<ItemsPage />);
    const newItem = screen.getByRole("button", { name: "New item" });
    expect(newItem).toHaveAttribute("data-variant", "default");
    await userEvent.click(newItem);
    expect(mocks.push).toHaveBeenCalledWith("/price-book/items?new=1", noScroll);
  });

  it("paints nothing else in the toolbar yellow", () => {
    renderWithClient(<ItemsPage />);
    const toolbar = screen.getByTestId("price-book-toolbar");
    const yellow = within(toolbar)
      .getAllByRole("button")
      .filter((b) => b.getAttribute("data-variant") === "default");
    expect(yellow.map((b) => b.textContent)).toEqual(["New item"]);
  });

  it("renders the Edit popup for ?edit=<id> and the New one for ?new=1", () => {
    mocks.params = new URLSearchParams("edit=p9");
    const { unmount } = renderWithClient(<ItemsPage />);
    expect(screen.getByTestId("product-dialog")).toHaveAttribute("data-product-id", "p9");
    unmount();
    mocks.params = new URLSearchParams("new=1");
    renderWithClient(<ItemsPage />);
    expect(screen.getByTestId("product-dialog")).toHaveAttribute("data-product-id", "new");
  });

  it("moves a just-created item into its Edit popup", async () => {
    mocks.params = new URLSearchParams("new=1");
    renderWithClient(<ItemsPage />);
    await userEvent.click(screen.getByRole("button", { name: "created" }));
    expect(mocks.replace).toHaveBeenCalledWith("/price-book/items?edit=new-1", noScroll);
  });

  it("clears the param when the popup closes", async () => {
    mocks.params = new URLSearchParams("edit=p9");
    renderWithClient(<ItemsPage />);
    await userEvent.click(screen.getByRole("button", { name: "close popup" }));
    expect(mocks.replace).toHaveBeenCalledWith("/price-book/items", noScroll);
  });

  it("hides New item and Import CSV without products.create", () => {
    mocks.denied = new Set(["products.create"]);
    renderWithClient(<ItemsPage />);
    expect(screen.queryByRole("button", { name: "New item" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Import CSV/ })).toBeNull();
  });
});

describe("ItemsPage — CSV", () => {
  beforeEach(() => {
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    URL.createObjectURL = vi.fn(() => "blob:items");
    URL.revokeObjectURL = vi.fn();
  });
  afterEach(() => vi.restoreAllMocks());

  it("exports the loaded rows, with the company cost only for financials.view", async () => {
    const { unmount } = renderWithClient(<ItemsPage />);
    await userEvent.click(screen.getByRole("button", { name: /Export CSV/ }));
    expect(mocks.csv).toHaveBeenCalledWith(mocks.items, { withCost: true });
    unmount();

    mocks.denied = new Set(["financials.view"]);
    renderWithClient(<ItemsPage />);
    await userEvent.click(screen.getByRole("button", { name: /Export CSV/ }));
    expect(mocks.csv).toHaveBeenLastCalledWith(mocks.items, { withCost: false });
  });

  it("opens the Inventory import dialog", async () => {
    renderWithClient(<ItemsPage />);
    await userEvent.click(screen.getByRole("button", { name: /Import CSV/ }));
    expect(screen.getByTestId("import-dialog")).toBeInTheDocument();
  });
});
