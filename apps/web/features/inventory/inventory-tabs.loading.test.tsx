import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup } from "@testing-library/react";
import type { ReactElement } from "react";
import { InventoryStatus, ProductType, TransferType, UserContainerAccess } from "@bitcrm/types";
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
} from "./loading-harness";

/**
 * Inventory's tabs do not jump while they load.
 *
 * In the browser, Warehouses, Templates and Transfers each moved by 0.047:
 * the pager sat under a page of skeleton rows — fifty, on a first visit — and
 * when three rows landed it shot up from below the fold. And rows were drawn
 * before what they print: Containers named a van's users a beat after the
 * rows, User containers drew every row with grey bars where the van would be,
 * Templates' "Used by" and Transfers' route names came the same way, and the
 * pager's "of N" came after the rows everywhere.
 *
 * Each tab now holds one skeleton — with no pager under it — until everything
 * it shows is in, and then draws it whole.
 */

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/inventory/items",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const stamp = { createdAt: "2026-09-01T10:00:00Z", updatedAt: "2026-09-01T10:00:00Z" };

const products = [1, 2, 3].map((n) => ({
  id: `p${n}`,
  number: 100 + n,
  sku: `SKU-${n}`,
  name: `Test item ${n}`,
  category: "Hardware",
  type: ProductType.PRODUCT,
  costCompany: 10,
  costTech: 12,
  priceClient: 40,
  serialTracking: false,
  minimumStockLevel: 0,
  manageStock: true,
  status: InventoryStatus.ACTIVE,
  ...stamp,
}));

const warehouses = [
  { id: "w1", name: "Main Store", status: InventoryStatus.ACTIVE, totalUnits: 10, uniqueItems: 2, ...stamp },
  { id: "w2", name: "Overflow Store", status: InventoryStatus.ACTIVE, totalUnits: 0, uniqueItems: 0, ...stamp },
];

const vans = [
  { id: "v1", name: "Van Alpha", status: InventoryStatus.ACTIVE, templateId: "t1", totalUnits: 4, uniqueItems: 1, ...stamp },
  { id: "v2", name: "Van Beta", status: InventoryStatus.ACTIVE, totalUnits: 0, uniqueItems: 0, ...stamp },
];

/** u7's row carries only an id (the backfill's): the van names them from `/users/by-ids`. */
const assignments = [
  { userId: "u7", userName: "", access: UserContainerAccess.CONTAINER, containerId: "v1", limited: false, updatedAt: stamp.updatedAt },
  { userId: "u8", userName: "Lee Park", access: UserContainerAccess.CONTAINER, containerId: "v2", limited: false, updatedAt: stamp.updatedAt },
];

const users = [
  { id: "u7", firstName: "Sam", lastName: "Rivera", email: "sam@example.test", roleId: "role-technician", status: "active", ...stamp },
  { id: "u8", firstName: "Lee", lastName: "Park", email: "lee@example.test", roleId: "role-technician", status: "active", ...stamp },
  // No row of their own: the fleet decides what they work from (here, nothing).
  { id: "u9", firstName: "Kim", lastName: "Ode", email: "kim@example.test", roleId: "role-dispatcher", status: "active", ...stamp },
];

const templates = [
  { id: "t1", name: "Standard van", status: InventoryStatus.ACTIVE, items: [{ productId: "p1", productName: "Test item 1", quantity: 2 }], ...stamp },
];

const transfers = [
  {
    id: "tr1",
    type: TransferType.TRANSFER,
    fromType: "warehouse",
    fromId: "w1",
    toType: "container",
    toId: "v1",
    items: [{ productId: "p1", productName: "Test item 1", quantity: 2 }],
    performedBy: "u-me",
    performedByName: "dana@example.test",
    ...stamp,
  },
];

let role = "role-admin";
let meDelay = 30;

/**
 * The order the browser sees: the user, then each list, and its count and
 * whatever names its rows a beat after the rows themselves.
 */
const routes = (): FakeRoute[] => [
  meRoute(role, meDelay),
  pageRoute(/\/inventory\/products$/, () => products, 60),
  countRoute(/\/inventory\/products\/count$/, () => products.length, 120),
  pageRoute(/\/inventory\/categories$/, () => [{ id: "c1", name: "Hardware", active: true, ...stamp }], 40),
  pageRoute(/\/inventory\/warehouses$/, () => warehouses, 60),
  countRoute(/\/inventory\/warehouses\/count$/, () => warehouses.length, 120),
  // The fleet is the slow one — the rows that name a van wait for it.
  pageRoute(/\/inventory\/containers$/, () => vans, 90),
  countRoute(/\/inventory\/containers\/count$/, () => vans.length, 120),
  pageRoute(/\/inventory\/user-containers$/, () => assignments, 70),
  { match: /\/users\/by-ids$/, method: "POST", reply: () => [{ id: "u7", firstName: "Sam", lastName: "Rivera" }], delayMs: 40 },
  pageRoute(/\/users$/, () => users, 60),
  countRoute(/\/users\/count$/, () => users.length, 60),
  { match: /\/inventory\/container-templates$/, reply: () => templates, delayMs: 60 },
  pageRoute(/\/inventory\/transfers$/, () => transfers, 60),
  countRoute(/\/inventory\/transfers\/count$/, () => transfers.length, 120),
];

let server: FakeServer;

const { default: InventoryTabsLayout } = await import("@/app/(app)/inventory/(tabs)/layout");
const { ProductsPage } = await import("./products/components/products-page");
const { WarehousesPage } = await import("./warehouses/components/warehouses-page");
const { ContainersPage } = await import("./containers/components/containers-page");
const { UserContainersPage } = await import("./user-containers/components/user-containers-page");
const { TemplatesPage } = await import("./templates/components/templates-page");
const { TransfersPage } = await import("./transfers/components/transfers-page");

const inTabs = (page: ReactElement) => renderPage(<InventoryTabsLayout>{page}</InventoryTabsLayout>);

beforeEach(() => {
  role = "role-admin";
  meDelay = 30;
  server = installFakeServer(routes());
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** Every tab: its page, a row it lists, and the "of N" its pager says. */
const TABS = [
  { tab: "Inventory", page: () => <ProductsPage />, row: "Test item 1", total: "of 3" },
  { tab: "Warehouses", page: () => <WarehousesPage />, row: "Main Store", total: "of 2" },
  { tab: "Containers", page: () => <ContainersPage />, row: "Van Alpha", total: "of 2" },
  { tab: "User containers", page: () => <UserContainersPage />, row: "Kim Ode", total: "of 3" },
  { tab: "Templates", page: () => <TemplatesPage />, row: "Standard van", total: "of 1" },
  { tab: "Transfers", page: () => <TransfersPage />, row: "Test item 1 ×2", total: "of 1" },
] as const;

describe.each(TABS)("Inventory — $tab", ({ page, row, total }) => {
  it("draws its rows whole, with the pager's total, in one frame", async () => {
    const watch = watchFirstFrame(
      () => !!screen.queryByText(row),
      () => ({ pager: pagerText()?.includes(total) ?? false, skeletons: skeletonCount() }),
    );
    inTabs(page());
    await screen.findByText(row, {}, { timeout: 3000 });
    watch.stop();

    expect(watch.frame()).toEqual({ pager: true, skeletons: 0 });
  });

  // Workiz's tab counters ("Inventory 99+", "Locations 94"): drawn one by one
  // they would slide the tabs about; they come in the rows' frame.
  it("brings the tab row's counters in the rows' frame", async () => {
    const watch = watchFirstFrame(
      () => !!screen.queryByText(row),
      () => ({
        warehouses: !!screen.queryByRole("link", { name: "Warehouses 2" }),
        templates: !!screen.queryByRole("link", { name: "Templates 1" }),
      }),
    );
    inTabs(page());
    await screen.findByText(row, {}, { timeout: 3000 });
    watch.stop();

    expect(watch.frame()).toEqual({ warehouses: true, templates: true });
  });

  it("puts no pager under the skeleton, where the rows would move it", async () => {
    const watch = watchPagerUnderSkeleton();
    inTabs(page());
    await screen.findByText(row, {}, { timeout: 3000 });
    await settle();
    watch.stop();

    expect(watch.seen()).toBe(false);
  });

  it("asks for each thing once", async () => {
    inTabs(page());
    await screen.findByText(row, {}, { timeout: 3000 });
    await settle();

    expect(duplicates(server.requests)).toEqual([]);
  });
});

describe("Inventory — what the rows print comes with them", () => {
  it("Containers: a van's users are named in the first frame", async () => {
    const watch = watchFirstFrame(
      () => !!screen.queryByText("Van Alpha"),
      () => ({ named: !!screen.queryByText("Sam Rivera"), shared: !!screen.queryByText("Lee Park") }),
    );
    inTabs(<ContainersPage />);
    await screen.findByText("Van Alpha", {}, { timeout: 3000 });
    watch.stop();

    expect(watch.frame()).toEqual({ named: true, shared: true });
  });

  it("User containers: each row has its van in the first frame, not grey bars", async () => {
    const watch = watchFirstFrame(
      () => !!screen.queryByText("Kim Ode"),
      () => ({ van: !!screen.queryByText("Van Alpha"), pending: screen.queryAllByTestId("assignment-pending").length }),
    );
    inTabs(<UserContainersPage />);
    await screen.findByText("Kim Ode", {}, { timeout: 3000 });
    watch.stop();

    expect(watch.frame()).toEqual({ van: true, pending: 0 });
  });

  it("Templates: Used by and the row's menu are there in the first frame", async () => {
    // The permissions answer last — a slow afternoon for /users/me.
    role = "role-super-admin";
    meDelay = 150;
    server = installFakeServer(routes());
    const watch = watchFirstFrame(
      () => !!screen.queryByText("Standard van"),
      () => ({
        pending: screen.queryAllByTestId("used-by-pending").length,
        menu: !!screen.queryByRole("button", { name: "Row actions" }),
      }),
    );
    inTabs(<TemplatesPage />);
    await screen.findByText("Standard van", {}, { timeout: 3000 });
    watch.stop();

    expect(watch.frame()).toEqual({ pending: 0, menu: true });
  });

  it("Transfers: the route names its warehouse and van in the first frame", async () => {
    const watch = watchFirstFrame(
      () => !!screen.queryByText("Test item 1 ×2"),
      () => ({ from: !!screen.queryByText("Main Store"), to: !!screen.queryByText("Van Alpha") }),
    );
    inTabs(<TransfersPage />);
    await screen.findByText("Test item 1 ×2", {}, { timeout: 3000 });
    watch.stop();

    expect(watch.frame()).toEqual({ from: true, to: true });
  });
});

describe("Inventory — Items, when the permissions answer", () => {
  it.each([
    ["an admin, who gets every control", "role-admin"],
    ["a dispatcher, who gets no Add New, no Import and no Cost", "role-dispatcher"],
  ])("never reshuffles the boxes, the strip or the columns — %s", async (_, who) => {
    role = who;
    server = installFakeServer(routes());
    const toolbarOf = () => screen.getByTestId("items-toolbar");
    const boxesOf = () => screen.getByTestId("items-filters");
    const columnsOf = (root: ParentNode) => [...root.querySelectorAll("thead th")].map((th) => th.textContent?.trim());
    const watch = watchFirstFrame(
      () => !!screen.queryByTestId("items-toolbar"),
      () => {
        const root = toolbarOf().parentElement!;
        return { root, controls: [...controlsIn(boxesOf()), ...controlsIn(toolbarOf())], columns: columnsOf(root) };
      },
    );
    inTabs(<ProductsPage />);
    await screen.findByText("Test item 1", {}, { timeout: 3000 });
    watch.stop();

    const first = watch.frame()!;
    const now = { controls: [...controlsIn(boxesOf()), ...controlsIn(toolbarOf())], columns: columnsOf(toolbarOf().parentElement!) };
    // Either the guess was right and nothing changed, or the frame was drawn
    // anew — new boxes in their places, not the old ones sliding across.
    const unchanged = JSON.stringify(now) === JSON.stringify({ controls: first.controls, columns: first.columns });
    expect(unchanged || !first.root.isConnected).toBe(true);
  });
});
