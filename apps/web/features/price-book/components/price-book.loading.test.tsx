import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, waitFor } from "@testing-library/react";
import { InventoryStatus, ProductType } from "@bitcrm/types";
import type { Product } from "@bitcrm/types";
import {
  duplicates,
  installFakeServer,
  settle,
  skeletonCount,
  watchFirstFrame,
  type FakeRoute,
  type FakeServer,
} from "@/test/page-load";
import {
  controlsIn,
  countRoute,
  meRoute,
  pageRoute,
  pagerText,
  renderPage,
  screen,
  watchPagerUnderSkeleton,
} from "@/features/inventory/loading-harness";

/**
 * The Price Book does not jump while it loads.
 *
 * In the browser (CLS 0.54 on Items, 0.015 on Categories and Brands) three
 * things moved the page under the reader:
 *
 * - the tab row was empty until the permissions answered, then 30px tall —
 *   everything under it went down;
 * - the toolbar had only the controls everyone gets; Category, Brand, Import
 *   and New item came with the permissions, wrapped it onto a second line and
 *   threw Export CSV from the right edge to the left of the line below;
 * - the rows came before the brands and before the count, so the Brand
 *   column read "—" and the pager's "of N" came a beat later.
 *
 * Now the frame is in place from the first paint (or, for a role it guessed
 * wrong, drawn anew rather than reshuffled) and the rows come with everything
 * they print.
 */

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => mocks.pathname,
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const mocks = vi.hoisted(() => ({ pathname: "/price-book/items" }));

const product = (n: number, over: Partial<Product> = {}): Product => ({
  id: `p${n}`,
  number: 100 + n,
  sku: `SKU-${n}`,
  name: `Test item ${n}`,
  category: "Hardware",
  type: ProductType.PRODUCT,
  brandId: "b1",
  costCompany: 10,
  costTech: 12,
  priceClient: 40 + n,
  serialTracking: false,
  minimumStockLevel: 0,
  status: InventoryStatus.ACTIVE,
  createdAt: "",
  updatedAt: "",
  ...over,
});

const entry = (id: string, name: string) => ({ id, name, active: true, createdBy: "", createdAt: "", updatedAt: "" });

let role = "role-admin";

/** The order the browser sees: the user, then the rows, then the brands, then the count. */
const routes = (): FakeRoute[] => [
  meRoute(role, 30),
  pageRoute(/\/inventory\/products$/, () => [product(1), product(2), product(3, { brandId: undefined })], 60),
  countRoute(/\/inventory\/products\/count$/, () => 3, 120),
  pageRoute(/\/inventory\/brands$/, () => [entry("b1", "Acme Hardware")], 90),
  pageRoute(/\/inventory\/categories$/, () => [entry("c1", "Hardware"), entry("c2", "Keys")], 40),
];

let server: FakeServer;

const { default: PriceBookTabsLayout } = await import("@/app/(app)/price-book/(tabs)/layout");
const { ItemsPage } = await import("./items-page");
const { CategoriesPage } = await import("./categories-page");

const tabRow = () => screen.queryByRole("navigation", { name: "Price Book sections" });
const toolbar = () => screen.queryByTestId("price-book-toolbar");
const columnsOf = (root: ParentNode) => [...root.querySelectorAll("thead th")].map((th) => th.textContent?.trim() ?? "");
const rowsUp = () => !!screen.queryByText("Test item 1");

beforeEach(() => {
  role = "role-admin";
  mocks.pathname = "/price-book/items";
  server = installFakeServer(routes());
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const renderItems = () =>
  renderPage(
    <PriceBookTabsLayout>
      <ItemsPage />
    </PriceBookTabsLayout>,
  );

describe("Price Book — the tab row", () => {
  it("holds its place while the permissions load", async () => {
    const watch = watchFirstFrame(
      () => !!tabRow(),
      () => tabRow()!.children.length,
    );
    renderItems();
    await screen.findByText("Test item 1", {}, { timeout: 3000 });
    watch.stop();

    // Items, Categories, Brands — placeholders first, the same size as the links.
    expect(watch.frame()).toBe(3);
  });
});

describe("Price Book — Items", () => {
  it("draws the rows with their brands and the pager's total, in one frame", async () => {
    const watch = watchFirstFrame(rowsUp, () => ({
      brand: screen.queryAllByText("Acme Hardware").length,
      pager: pagerText(),
      skeletons: skeletonCount(),
    }));
    renderItems();
    await screen.findByText("Test item 1", {}, { timeout: 3000 });
    watch.stop();

    expect(watch.frame()).toEqual({ brand: 2, pager: expect.stringContaining("Showing 1 to 3 of 3 results"), skeletons: 0 });
  });

  it("puts no pager under the skeleton, where the rows would move it", async () => {
    const watch = watchPagerUnderSkeleton();
    renderItems();
    await screen.findByText("Test item 1", {}, { timeout: 3000 });
    await waitFor(() => expect(pagerText()).toContain("of 3"));
    watch.stop();

    expect(watch.seen()).toBe(false);
  });

  it.each([
    ["an admin, who gets every control", "role-admin"],
    ["a dispatcher, who gets no New item, no Import and no Cost", "role-dispatcher"],
  ])("never reshuffles the toolbar or the columns when the permissions answer — %s", async (_, who) => {
    role = who;
    server = installFakeServer(routes());
    const watch = watchFirstFrame(
      () => !!toolbar(),
      () => {
        const bar = toolbar()!;
        return { root: bar.parentElement!, controls: controlsIn(bar), columns: columnsOf(bar.parentElement!) };
      },
    );
    renderItems();
    await screen.findByText("Test item 1", {}, { timeout: 3000 });
    watch.stop();

    const first = watch.frame()!;
    const now = { controls: controlsIn(toolbar()!), columns: columnsOf(toolbar()!.parentElement!) };
    // Either the guess was right and nothing changed, or the frame was drawn
    // anew — new boxes in their places, not the old ones sliding across.
    const unchanged = JSON.stringify(now) === JSON.stringify({ controls: first.controls, columns: first.columns });
    expect(unchanged || !first.root.isConnected).toBe(true);
  });

  it("asks for the brands and categories beside the permissions, not after them", () => {
    renderItems();

    expect(server.requests.map((r) => r.split("?")[0])).toEqual(
      expect.arrayContaining(["/api/inventory/brands", "/api/inventory/categories"]),
    );
  });

  it("asks for each thing once", async () => {
    renderItems();
    await screen.findByText("Test item 1", {}, { timeout: 3000 });
    await settle();

    expect(duplicates(server.requests)).toEqual([]);
  });
});

describe("Price Book — Categories", () => {
  beforeEach(() => {
    mocks.pathname = "/price-book/categories";
  });

  const renderCategories = () =>
    renderPage(
      <PriceBookTabsLayout>
        <CategoriesPage />
      </PriceBookTabsLayout>,
    );

  it("draws the rows with the tabs and New category, in one frame", async () => {
    const watch = watchFirstFrame(
      () => !!screen.queryByText("Keys"),
      () => ({
        tabs: tabRow()!.querySelectorAll("a").length,
        create: !!screen.queryByRole("button", { name: /New category/ }),
        skeletons: skeletonCount(),
      }),
    );
    renderCategories();
    await screen.findByText("Keys", {}, { timeout: 3000 });
    watch.stop();

    expect(watch.frame()).toEqual({ tabs: 3, create: true, skeletons: 0 });
  });

  it("asks for the catalog beside the permissions, once", async () => {
    renderCategories();
    expect(server.requests.map((r) => r.split("?")[0])).toContain("/api/inventory/categories");

    await screen.findByText("Keys", {}, { timeout: 3000 });
    await settle();
    expect(duplicates(server.requests)).toEqual([]);
  });
});
