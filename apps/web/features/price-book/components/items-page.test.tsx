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
  push: vi.fn(),
  replace: vi.fn(),
  csv: vi.fn<(...args: unknown[]) => string>(() => "csv"),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push, replace: mocks.replace }),
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
      isPending: mocks.loading,
      fetchStatus: mocks.loading ? "fetching" : "idle",
      isError: false,
      isPlaceholderData: mocks.placeholder,
      fetchNextPage: vi.fn(),
      refetch: vi.fn(),
    };
  },
  usePriceBookCount: (filter: ProductFilter) => {
    mocks.countFilters.push(filter);
    return {
      data: mocks.loading ? undefined : { total: mocks.items.length, atLeast: false },
      isPending: mocks.loading,
      fetchStatus: mocks.loading ? "fetching" : "idle",
      isError: false,
    };
  },
}));
vi.mock("@/features/inventory/products/hooks", () => ({
  useItemCategories: (enabled: boolean) => {
    mocks.categoriesEnabled.push(enabled);
    return { data: enabled ? mocks.categories : undefined, isPending: !enabled, fetchStatus: "idle", isError: false };
  },
  useBrands: (enabled: boolean) => {
    mocks.brandsEnabled.push(enabled);
    return { data: enabled ? mocks.brands : undefined, isPending: !enabled, fetchStatus: "idle", isError: false };
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
// The popup has a suite of its own; here only which one the row opens matters.
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
    description: "Single cylinder",
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

const show = () => screen.getByRole("combobox", { name: "Show" });
const optionsOf = (group: string) =>
  within(within(screen.getByRole("listbox")).getByRole("group", { name: group }))
    .getAllByRole("option")
    .map((o) => o.textContent);

async function pick(option: string) {
  await userEvent.click(show());
  await userEvent.click(await screen.findByRole("option", { name: option }));
}

beforeEach(() => {
  mocks.filters = [];
  mocks.limits = [];
  mocks.countFilters = [];
  mocks.resetKeys = [];
  mocks.items = [
    product(),
    product({
      id: "s1",
      number: 8,
      name: "Rekey",
      sku: "SVC-1",
      description: "",
      category: "Platinum > Private",
      type: ProductType.SERVICE,
      brandId: undefined,
      availableInBooking: true,
      taxable: false,
    }),
  ];
  mocks.loading = false;
  mocks.placeholder = false;
  mocks.categories = [row("c1", "Locks"), row("c2", "Keys"), row("c3", "Retired", false)];
  mocks.brands = [row("b1", "Schlage"), row("b2", "Kwikset")];
  mocks.categoriesEnabled = [];
  mocks.brandsEnabled = [];
  mocks.denied = new Set();
  window.history.replaceState(null, "", "/");
  mocks.push.mockReset();
  mocks.replace.mockReset();
  mocks.csv.mockClear();
});

describe("ItemsPage — Workiz's Show box, filtered on the server", () => {
  it("starts on Workiz's one chip, status: Active items — list and count alike", () => {
    renderWithClient(<ItemsPage />);
    expect(screen.getByText("Show:")).toBeInTheDocument();
    expect(screen.getByText("status: Active items")).toBeInTheDocument();
    expect(mocks.filters.at(-1)).toEqual({ status: InventoryStatus.ACTIVE });
    expect(mocks.countFilters.at(-1)).toEqual(mocks.filters.at(-1));
  });

  it("lays out Workiz's groups side by side, ours (Inventory) last", async () => {
    renderWithClient(<ItemsPage />);
    await userEvent.click(show());
    const groups = within(screen.getByRole("listbox"))
      .getAllByRole("group")
      .map((g) => g.getAttribute("aria-label"));
    expect(groups).toEqual(["Item type", "Status", "Category", "Brand", "Inventory"]);
    // Active items is already a chip: only the other status is offered.
    expect(optionsOf("Status")).toEqual(["Disabled items"]);
  });

  it("filters by item type, and both types are no narrowing", async () => {
    renderWithClient(<ItemsPage />);
    await pick("Service");
    expect(mocks.filters.at(-1)).toEqual({ type: ProductType.SERVICE, status: InventoryStatus.ACTIVE });
    await pick("Product");
    expect(mocks.filters.at(-1)?.type).toBeUndefined();
  });

  it("offers every catalog category by name, sorted, one at a time, and sends the name", async () => {
    renderWithClient(<ItemsPage />);
    await userEvent.click(show());
    expect(optionsOf("Category")).toEqual(["Keys", "Locks", "Retired"]);
    await userEvent.click(screen.getByRole("option", { name: "Keys" }));
    expect(mocks.filters.at(-1)).toMatchObject({ category: "Keys" });
    await pick("Locks");
    expect(mocks.filters.at(-1)).toMatchObject({ category: "Locks" });
    expect(screen.queryByText("category: Keys")).toBeNull();
    expect(screen.getByText("category: Locks")).toBeInTheDocument();
  });

  it("offers the brands by name, sorted, and sends the brand's id", async () => {
    renderWithClient(<ItemsPage />);
    await userEvent.click(show());
    expect(optionsOf("Brand")).toEqual(["Kwikset", "Schlage"]);
    await userEvent.click(screen.getByRole("option", { name: "Kwikset" }));
    expect(mocks.filters.at(-1)).toMatchObject({ brandId: "b2" });
  });

  it("drops the status with its chip, and reads Disabled items as archived", async () => {
    renderWithClient(<ItemsPage />);
    await userEvent.click(screen.getByRole("button", { name: "Remove status: Active items" }));
    expect(mocks.filters.at(-1)?.status).toBeUndefined();
    await pick("Disabled items");
    expect(mocks.filters.at(-1)?.status).toBe(InventoryStatus.ARCHIVED);
  });

  it("filters by Inventory: Yes is stock-managed, No is not", async () => {
    renderWithClient(<ItemsPage />);
    await pick("Yes");
    expect(mocks.filters.at(-1)?.manageStock).toBe(true);
    await userEvent.click(screen.getByRole("button", { name: "Remove inventory: Yes" }));
    await pick("No");
    expect(mocks.filters.at(-1)?.manageStock).toBe(false);
  });

  it("sends the search after a pause, not on every keystroke", async () => {
    renderWithClient(<ItemsPage />);
    await userEvent.type(screen.getByPlaceholderText("Search"), "dead");
    await waitFor(() => expect(mocks.filters.at(-1)).toMatchObject({ search: "dead" }));
    expect(mocks.filters.some((f) => f.search === "de")).toBe(false);
  });

  it("combines every filter in one request, and counts under the same", async () => {
    renderWithClient(<ItemsPage />);
    await pick("Product");
    await pick("Locks");
    await pick("Schlage");
    await pick("Disabled items");
    await userEvent.click(screen.getByRole("button", { name: "Remove status: Active items" }));
    await pick("No");
    await userEvent.type(screen.getByPlaceholderText("Search"), "bolt");
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
    await pick("Service");
    const after = mocks.resetKeys.at(-1)!;
    expect(after).not.toBe(before);
    expect(JSON.parse(after)).toEqual({
      filter: { type: ProductType.SERVICE, status: InventoryStatus.ACTIVE },
      pageSize: mocks.limits.at(-1),
    });
  });

  it("offers Workiz's page sizes, 5 to 100", () => {
    renderWithClient(<ItemsPage />);
    const size = screen.getByRole("combobox", { name: "Rows per page" });
    expect([...size.querySelectorAll("option")].map((o) => o.textContent)).toEqual(["5", "10", "20", "25", "50", "100"]);
  });

  it("reads each catalog only with its view permission, and then leaves its group out", async () => {
    mocks.denied = new Set(["product_categories.view", "brands.view"]);
    renderWithClient(<ItemsPage />);
    expect(mocks.categoriesEnabled.at(-1)).toBe(false);
    expect(mocks.brandsEnabled.at(-1)).toBe(false);
    await userEvent.click(show());
    const groups = within(screen.getByRole("listbox"))
      .getAllByRole("group")
      .map((g) => g.getAttribute("aria-label"));
    expect(groups).toEqual(["Item type", "Status", "Inventory"]);
  });
});

describe("ItemsPage — Workiz's grid", () => {
  const grid = () => screen.getByRole("table", { name: "Items & products" });
  const heads = () => within(grid()).getAllByRole("columnheader").map((h) => h.textContent);

  it("has Workiz's columns in its order", () => {
    renderWithClient(<ItemsPage />);
    expect(heads()).toEqual([
      "Id",
      "Name",
      "Description",
      "Price",
      "Cost",
      "Type",
      "Category",
      "Model #",
      "Brand",
      "Booking",
      "Inventory",
      "Taxable",
    ]);
  });

  it("prints each item as Workiz does", () => {
    renderWithClient(<ItemsPage />);
    const [deadbolt, rekey] = within(grid()).getAllByRole("row").slice(1, 3);
    expect([...deadbolt.querySelectorAll("td")].map((td) => td.textContent)).toEqual([
      "7",
      "Deadbolt",
      "Single cylinder",
      "$45.00",
      "$10.00",
      "Product",
      "Locks",
      "LOCK-001",
      "Schlage",
      "No",
      "Yes",
      "Yes",
    ]);
    expect([...rekey.querySelectorAll("td")].map((td) => td.textContent)).toEqual([
      "8",
      "Rekey",
      "",
      "$45.00",
      "$10.00",
      "Service",
      "Private",
      "SVC-1",
      "",
      "Yes",
      "No",
      "No",
    ]);
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

  it("draws the first load as Workiz's grid under its loader, with no pager yet", () => {
    mocks.loading = true;
    renderWithClient(<ItemsPage />);
    expect(heads()).toHaveLength(12);
    expect(screen.getByRole("status", { name: "Loading" })).toBeInTheDocument();
    expect(screen.queryByTestId("list-pagination")).toBeNull();
  });

  it("keeps the previous filter's rows, dimmed, and does not page through them", () => {
    mocks.placeholder = true;
    renderWithClient(<ItemsPage />);
    expect(document.querySelector("[data-slot=wz-report-grid]")).toHaveAttribute("aria-busy", "true");
    // Workiz always draws ‹ ›; on the old set they go nowhere.
    expect(screen.getByRole("button", { name: "Next page" })).toBeDisabled();
  });

  it("puts Workiz's pager inside the grid: Showing 1 to 2 of 2 results", () => {
    renderWithClient(<ItemsPage />);
    expect(within(document.querySelector("[data-slot=wz-report-grid]") as HTMLElement).getByTestId("list-pagination")).toHaveTextContent(
      "Showing 1 to 2 of 2 results",
    );
  });

  it("says No Records Found when nothing matches", () => {
    mocks.items = [];
    renderWithClient(<ItemsPage />);
    expect(screen.getByText("No Records Found")).toBeInTheDocument();
  });

  it("refuses without products.view", () => {
    mocks.denied = new Set(["products.view"]);
    renderWithClient(<ItemsPage />);
    expect(screen.getByText("No access")).toBeInTheDocument();
    expect(screen.queryByRole("table")).toBeNull();
  });
});

/** The owner's rule: a popup is the page's state, never the address. */
describe("ItemsPage — popups are state, not the URL", () => {
  const address = () => `${window.location.pathname}${window.location.search}`;
  beforeEach(() => window.history.replaceState(null, "", "/price-book/items"));

  it("opens Workiz's Edit Item from anywhere on the row, the address untouched", async () => {
    renderWithClient(<ItemsPage />);
    await userEvent.click(screen.getByText("LOCK-001"));
    expect(screen.getByTestId("product-dialog")).toHaveAttribute("data-product-id", "p1");
    expect(address()).toBe("/price-book/items");
    expect(mocks.push).not.toHaveBeenCalled();
    expect(mocks.replace).not.toHaveBeenCalled();
  });

  it("opens the Add New Item popup from Workiz's one yellow Add New", async () => {
    renderWithClient(<ItemsPage />);
    const add = screen.getByRole("button", { name: "Add New" });
    expect(add).toHaveAttribute("data-variant", "default");
    await userEvent.click(add);
    expect(screen.getByTestId("product-dialog")).toHaveAttribute("data-product-id", "new");
    expect(address()).toBe("/price-book/items");
  });

  it("paints nothing else yellow", () => {
    renderWithClient(<ItemsPage />);
    const yellow = screen.getAllByRole("button").filter((b) => b.getAttribute("data-variant") === "default");
    expect(yellow.map((b) => b.textContent)).toEqual(["Add New"]);
  });

  // No deep links: an old link with the popup in its query lands on the plain list.
  it("opens nothing from an old ?edit= / ?new=1 link, and takes it out of the address", () => {
    window.history.replaceState(null, "", "/price-book/items?edit=p9");
    const { unmount } = renderWithClient(<ItemsPage />);
    expect(screen.queryByTestId("product-dialog")).toBeNull();
    expect(address()).toBe("/price-book/items");
    unmount();
    window.history.replaceState(null, "", "/price-book/items?new=1");
    renderWithClient(<ItemsPage />);
    expect(screen.queryByTestId("product-dialog")).toBeNull();
    expect(address()).toBe("/price-book/items");
  });

  it("moves a just-created item into its Edit popup", async () => {
    renderWithClient(<ItemsPage />);
    await userEvent.click(screen.getByRole("button", { name: "Add New" }));
    await userEvent.click(screen.getByRole("button", { name: "created" }));
    expect(screen.getByTestId("product-dialog")).toHaveAttribute("data-product-id", "new-1");
  });

  it("closes the popup back to the list", async () => {
    renderWithClient(<ItemsPage />);
    await userEvent.click(screen.getByText("LOCK-001"));
    await userEvent.click(screen.getByRole("button", { name: "close popup" }));
    expect(screen.queryByTestId("product-dialog")).toBeNull();
    expect(address()).toBe("/price-book/items");
  });

  it("hides Add New and Import without products.create", () => {
    mocks.denied = new Set(["products.create"]);
    renderWithClient(<ItemsPage />);
    expect(screen.queryByRole("button", { name: "Add New" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Import/ })).toBeNull();
  });
});

describe("ItemsPage — CSV", () => {
  beforeEach(() => {
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    URL.createObjectURL = vi.fn(() => "blob:items");
    URL.revokeObjectURL = vi.fn();
  });
  afterEach(() => vi.restoreAllMocks());

  it("exports the loaded rows from Workiz's Export, the company cost only for financials.view", async () => {
    const { unmount } = renderWithClient(<ItemsPage />);
    await userEvent.click(screen.getByRole("button", { name: "Export" }));
    expect(mocks.csv).toHaveBeenCalledWith(mocks.items, { withCost: true });
    unmount();

    mocks.denied = new Set(["financials.view"]);
    renderWithClient(<ItemsPage />);
    await userEvent.click(screen.getByRole("button", { name: "Export" }));
    expect(mocks.csv).toHaveBeenLastCalledWith(mocks.items, { withCost: false });
  });

  it("keeps ours beside it — Import opens the Inventory import dialog", async () => {
    renderWithClient(<ItemsPage />);
    await userEvent.click(screen.getByRole("button", { name: "Import" }));
    expect(screen.getByTestId("import-dialog")).toBeInTheDocument();
  });
});
