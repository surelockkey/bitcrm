import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import { InventoryStatus, UserContainerAccess } from "@bitcrm/types";
import { installFakeServer, renderWithClient, type FakeRoute, type FakeServer } from "@/test/page-load";

/**
 * My Stock is Workiz's "Manage stock: <location>" sheet for the van
 * (pg_inventory_wz_13_location_stock), read-only: the van's name and
 * description at the left, "Total Items On Hand" at the right, the grey strip
 * with Search, the page size and Export, and the grid — Product Name and
 * Quantity, ours SKU and Category, Price and Cost only for a viewer who may
 * see money. Low stock first, with Workiz's "Low stock" tag.
 */

/** What the signed-in viewer may do — a technician; a test widens or narrows it. */
let granted: (resource: string) => boolean = (resource) => resource === "containers";
vi.mock("@/features/auth/use-permissions", () => ({
  useDenied: () => (resource: string) => !granted(resource),
  usePermissions: () => ({ can: (resource: string) => granted(resource), isTechnician: true, isLoading: false }),
}));

const downloads = vi.hoisted(() => [] as { name: string; csv: string }[]);
vi.mock("@/features/reports/billing/lib", async (original) => ({
  ...(await original<typeof import("@/features/reports/billing/lib")>()),
  downloadCsv: (name: string, csv: string) => downloads.push({ name, csv }),
}));

const stamp = { createdAt: "2026-09-01T10:00:00Z", updatedAt: "2026-09-01T10:00:00Z" };

const VAN_ROUTES: FakeRoute[] = [
  {
    match: /\/inventory\/user-containers\/me$/,
    reply: () => ({ userId: "u-me", userName: "Tess Tech", access: UserContainerAccess.CONTAINER, containerId: "v1", limited: false, updatedAt: stamp.updatedAt }),
  },
  {
    match: /\/inventory\/containers\/v1$/,
    reply: () => ({ id: "v1", name: "(CT) BILL RYAN - 7318", description: "3N6CM0KN9MK697318", department: "Connecticut", status: InventoryStatus.ACTIVE, ...stamp }),
  },
];

const STOCK = {
  match: /\/inventory\/stock\/locations\/container\/v1$/,
  reply: () => ({
    name: "(CT) BILL RYAN - 7318",
    status: InventoryStatus.ACTIVE,
    rows: [
      { productId: "p1", productName: "Key blank", sku: "KEY-1", category: "Keys", quantity: 120, priceClient: 2.5, costCompany: 0.4 },
      { productId: "p2", productName: "Deadbolt", sku: "LOCK-1", category: "Locks", quantity: 2, priceClient: 125, costCompany: 20.16, minimumStockLevel: 10 },
    ],
  }),
};

let server: FakeServer;

const { MyStockPage } = await import("./my-stock-page");

function serve(routes: FakeRoute[] = [...VAN_ROUTES, STOCK]) {
  server = installFakeServer(routes, { delayMs: 5 });
}

beforeEach(() => {
  granted = (resource: string) => resource === "containers";
  downloads.length = 0;
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const grid = () => screen.getByRole("table", { name: "My stock" });
const bodyRows = () => within(grid()).getAllByRole("row").filter((r) => !r.getAttribute("aria-hidden")).slice(1);

describe("MyStockPage — the van's stock sheet", () => {
  it("refuses a viewer who may not see containers", () => {
    granted = () => false;
    serve();
    renderWithClient(<MyStockPage />);
    expect(screen.getByText("No access")).toBeInTheDocument();
  });

  it("tells a technician with no van who to ask", async () => {
    serve([{ match: /\/inventory\/user-containers\/me$/, status: 404, reply: () => null }]);
    renderWithClient(<MyStockPage />);

    expect(await screen.findByText("No van assigned", {}, { timeout: 3000 })).toBeInTheDocument();
    expect(screen.getByText(/ask the office/i)).toBeInTheDocument();
  });

  it("names the van at the left and what is on it at the right — no money for a technician", async () => {
    serve();
    renderWithClient(<MyStockPage />);

    expect(await screen.findByRole("heading", { name: "(CT) BILL RYAN - 7318" }, { timeout: 3000 })).toBeInTheDocument();
    expect(screen.getByText("3N6CM0KN9MK697318 Connecticut")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Total Items On Hand: 122" })).toBeInTheDocument();
    expect(screen.queryByText(/Total Items cost/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Sale Items Value/)).not.toBeInTheDocument();
    expect(within(grid()).getAllByRole("columnheader").map((h) => h.textContent)).toEqual(["Product Name", "SKU", "Category", "Quantity"]);
  });

  it("adds Workiz's money — the totals and the Price and Cost columns — for a viewer who may see it", async () => {
    granted = (resource: string) => resource === "containers" || resource === "financials";
    serve();
    renderWithClient(<MyStockPage />);

    expect(await screen.findByRole("heading", { name: "Total Items cost: 88.32" }, { timeout: 3000 })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Sale Items Value: 550" })).toBeInTheDocument();
    expect(within(grid()).getAllByRole("columnheader").map((h) => h.textContent)).toEqual([
      "Product Name",
      "SKU",
      "Category",
      "Quantity",
      "Price",
      "Cost",
    ]);
  });

  it("lists low stock first, with Workiz's Low stock tag", async () => {
    serve();
    renderWithClient(<MyStockPage />);
    await screen.findByText("Deadbolt", {}, { timeout: 3000 });

    const rows = bodyRows();
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent("Deadbolt");
    expect(within(rows[0]).getByText("Low stock")).toBeInTheDocument();
    expect(rows[1]).toHaveTextContent("Key blank");
    expect(within(rows[1]).queryByText("Low stock")).not.toBeInTheDocument();
  });

  it("searches the grid, and says No Records Found when nothing matches", async () => {
    serve();
    renderWithClient(<MyStockPage />);
    await screen.findByText("Deadbolt", {}, { timeout: 3000 });

    fireEvent.change(screen.getByRole("searchbox", { name: "Search" }), { target: { value: "key" } });
    expect(bodyRows()).toHaveLength(1);
    expect(screen.getByText("Key blank")).toBeInTheDocument();

    fireEvent.change(screen.getByRole("searchbox", { name: "Search" }), { target: { value: "chainsaw" } });
    expect(bodyRows()).toHaveLength(0);
    expect(screen.getByText("No Records Found")).toBeInTheDocument();
  });

  it("exports what is on the van", async () => {
    serve();
    renderWithClient(<MyStockPage />);
    await screen.findByText("Deadbolt", {}, { timeout: 3000 });

    fireEvent.click(screen.getByRole("button", { name: /Export/ }));
    expect(downloads).toHaveLength(1);
    expect(downloads[0].name).toMatch(/\.csv$/);
    expect(downloads[0].csv.split("\r\n")[0]).toBe("Product Name,SKU,Category,Quantity");
  });

  it("an empty van is an empty grid, as Workiz's", async () => {
    serve([...VAN_ROUTES, { ...STOCK, reply: () => ({ name: "(CT) BILL RYAN - 7318", status: InventoryStatus.ACTIVE, rows: [] }) }]);
    renderWithClient(<MyStockPage />);

    expect(await screen.findByText("No Records Found", {}, { timeout: 3000 })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Total Items On Hand: 0" })).toBeInTheDocument();
  });

  it("says so when the stock could not be loaded", async () => {
    serve();
    server.fail(/\/inventory\/stock\/locations\/container\/v1$/);
    renderWithClient(<MyStockPage />);

    expect(await screen.findByText(/couldn't load your stock/i, {}, { timeout: 3000 })).toBeInTheDocument();
  });
});
