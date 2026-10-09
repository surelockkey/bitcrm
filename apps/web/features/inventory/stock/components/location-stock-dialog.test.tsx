import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { InventoryStatus, ReturnReason } from "@bitcrm/types";
import { server } from "@/test/msw/server";
import { renderWithClient } from "@/test/render-with-client";
import type { StockLocation } from "../lib";
import type { LocationStockRowIn as LocationStockRow } from "../api";

type Mutate = (vars: unknown, opts?: { onSuccess?: () => void }) => void;

const mocks = vi.hoisted(() => ({
  denied: new Set<string>(),
  move: vi.fn(),
  ret: vi.fn(),
  receive: vi.fn(),
  urls: [] as string[],
}));

vi.mock("@/features/auth/use-permissions", () => ({
  useDenied: () => () => false,
  usePermissions: () => ({
    can: (resource: string, action = "view") => !mocks.denied.has(`${resource}.${action}`),
  }),
}));

const active = InventoryStatus.ACTIVE;
const LOCATIONS: StockLocation[] = [
  { type: "warehouse", id: "w1", name: "Main", status: active },
  { type: "container", id: "c1", name: "Taras's van", status: active },
  { type: "container", id: "c2", name: "Pavlo's van", status: active },
];

// The movement dialogs run for real; only their mutations are stubbed.
const mutation = (fn: (vars: unknown) => void) => ({
  isPending: false,
  mutate: ((vars, opts) => {
    fn(vars);
    opts?.onSuccess?.();
  }) as Mutate,
});
vi.mock("../hooks", async (importOriginal) => ({
  // The stock itself is read for real, through MSW.
  useLocationStock: (await importOriginal<typeof import("../hooks")>()).useLocationStock,
  useMoveStock: () => mutation(mocks.move),
  useReturnStock: () => mutation(mocks.ret),
  useReceiveStock: () => mutation(mocks.receive),
  useAllLocations: () => ({ data: LOCATIONS, isLoading: false, isError: false }),
}));

import { LocationStockDialog } from "./location-stock-dialog";

const row = (
  productId: string,
  productName: string,
  quantity: number,
  over: Partial<LocationStockRow> = {},
): LocationStockRow => ({ productId, productName, quantity, ...over });

/** What GET /stock/locations/:type/:id answers: in-stock rows, named and priced. */
const view = (locationType: string, locationId: string, name: string, rows: LocationStockRow[]) => ({
  success: true,
  data: { locationType, locationId, name, status: active, rows },
});

let vanRows: LocationStockRow[];

beforeEach(() => {
  mocks.denied = new Set();
  mocks.move.mockReset();
  mocks.ret.mockReset();
  mocks.receive.mockReset();
  mocks.urls = [];
  // Already in name order: the server sorts, the popup doesn't sort again.
  vanRows = [
    row("p1", "Deadbolt", 6, { sku: "LOCK-001", priceClient: 45, minimumStockLevel: 10 }),
    row("p2", "Key blank", 120, { sku: "KEY-7", priceClient: 3 }),
  ];
  server.events.on("request:start", ({ request }) => {
    mocks.urls.push(new URL(request.url).pathname.replace(/^.*\/inventory/, "/inventory"));
  });
  // Anything else the popup asked for would be an unhandled request — an error.
  server.use(
    http.get("*/inventory/stock/locations/container/c1", () =>
      HttpResponse.json(view("container", "c1", "Taras's van", vanRows)),
    ),
    http.get("*/inventory/stock/locations/warehouse/w1", () =>
      HttpResponse.json(
        view("warehouse", "w1", "Main", [row("p3", "Strike plate", 40, { sku: "STR-1", priceClient: 12 })]),
      ),
    ),
  );
  return () => server.events.removeAllListeners();
});

function open(type: "container" | "warehouse" = "container", id = type === "container" ? "c1" : "w1") {
  const onOpenChange = vi.fn();
  renderWithClient(
    <LocationStockDialog type={type} locationId={id} open onOpenChange={onOpenChange} />,
  );
  return { onOpenChange };
}

/** The records the grid prints — Workiz's blank filler rows left out. */
const bodyRows = () =>
  [...document.querySelectorAll('[role="dialog"] tbody tr:not([aria-hidden])')].map((tr) =>
    [...tr.querySelectorAll("td")].map((td) => td.textContent),
  );
const headers = () => [...document.querySelectorAll('[role="dialog"] thead th')].map((th) => th.textContent);

/**
 * Workiz's "Manage stock: <name>" (pg_inventory_wz_13_location_stock): the
 * location and its three totals over the standard grid — Product Name,
 * Quantity, Price, Cost, Actions.
 */
describe("LocationStockDialog — a van's stock", () => {
  it("is titled \"Manage stock: <name>\", the name and its description at the left", async () => {
    vanRows = vanRows.map((r) => r);
    open();
    expect(await screen.findByRole("dialog", { name: "Manage stock: Taras's van" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 3, name: "Taras's van" })).toBeInTheDocument();
  });

  it("lists what the van holds — name, quantity, price, cost — left-aligned", async () => {
    vanRows = [row("p1", "Deadbolt", 6, { sku: "LOCK-001", priceClient: 45, costCompany: 20.16 })];
    open();
    await screen.findByText("Deadbolt");
    expect(headers()).toEqual(["Product Name", "Quantity", "Price", "Cost", "Actions"]);
    expect(bodyRows().map((r) => r.slice(0, 4))).toEqual([["Deadbolt", "6", "45.00", "20.16"]]);
    for (const cell of document.querySelectorAll('[role="dialog"] th, [role="dialog"] td')) {
      expect(cell.className).not.toMatch(/text-right/);
    }
  });

  it("keeps the cost from someone who may not see money", async () => {
    mocks.denied.add("financials.view");
    open();
    await screen.findByText("Deadbolt");
    expect(headers()).toEqual(["Product Name", "Quantity", "Price", "Actions"]);
    expect(screen.queryByText(/Total Items cost/)).toBeNull();
  });

  // F2 answers in name order; sorting again would be work, and wrong if the
  // server ever orders on something the browser can't see.
  it("keeps the server's order", async () => {
    vanRows = [row("p2", "Key blank", 1), row("p1", "Deadbolt", 1)];
    open();
    await screen.findByText("Deadbolt");
    expect(bodyRows().map((r) => r[0])).toEqual(["Key blank", "Deadbolt"]);
  });

  it("tags an item that has run low with Workiz's Low stock", async () => {
    open();
    await screen.findByText("Deadbolt");
    expect(bodyRows()[0][0]).toBe("DeadboltLow stock");
    expect(bodyRows()[1][0]).toBe("Key blank");
  });

  it("totals the units and prices them at the client price", async () => {
    open();
    await screen.findByText("Deadbolt");
    expect(screen.getByText("Total Items On Hand: 126")).toBeInTheDocument();
    expect(screen.getByText("Sale Items Value: 630.00")).toBeInTheDocument();
  });

  // The popup took over eight seconds on dev: it paged the whole
  // stock-managed catalog (3 102 items, 32 requests) to name the rows.
  it("reads the van in one request — no catalog, no container lookup", async () => {
    open();
    await screen.findByText("Deadbolt");
    expect(mocks.urls).toEqual(["/inventory/stock/locations/container/c1"]);
  });

  // The Containers tab puts the van's template strip here.
  it("shows what the page puts over the stock", async () => {
    renderWithClient(
      <LocationStockDialog type="container" locationId="c1" open onOpenChange={vi.fn()} aside={<div>Template strip</div>} />,
    );
    await screen.findByText("Deadbolt");
    expect(screen.getByText("Template strip")).toBeInTheDocument();
  });

  it("closes from the footer's Cancel", async () => {
    const { onOpenChange } = open();
    await screen.findByText("Deadbolt");
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});

describe("LocationStockDialog — move and return, never add", () => {
  it("offers Move and Return per item, and no ＋", async () => {
    open();
    await screen.findByText("Deadbolt");
    expect(screen.getByRole("button", { name: "Move Deadbolt from Taras's van" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Return Deadbolt from Taras's van" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: /^Add / })).toBeNull();
  });

  it("moves from this van to another one", async () => {
    open();
    await userEvent.click(await screen.findByRole("button", { name: "Move Deadbolt from Taras's van" }));
    const move = screen.getByRole("dialog", { name: "Move items to container" });
    await userEvent.click(within(move).getByRole("combobox", { name: "To location" }));
    await userEvent.click(screen.getByRole("option", { name: /Pavlo's van/ }));
    const qty = within(move).getByLabelText("Quantity");
    await userEvent.clear(qty);
    await userEvent.type(qty, "4");
    await userEvent.click(within(move).getByRole("button", { name: "Save" }));

    expect(mocks.move).toHaveBeenCalledWith({
      fromType: "container",
      fromId: "c1",
      toType: "container",
      toId: "c2",
      items: [{ productId: "p1", productName: "Deadbolt", quantity: 4 }],
    });
    // Only the small dialog closes; the van's popup stays.
    expect(screen.getByRole("dialog", { name: "Manage stock: Taras's van" })).toBeInTheDocument();
  });

  it("returns out of this van with a reason, no more than it holds", async () => {
    open();
    await userEvent.click(await screen.findByRole("button", { name: "Return Deadbolt from Taras's van" }));
    const ret = screen.getByRole("dialog", { name: "Item return" });
    const qty = within(ret).getByLabelText("Quantity");
    await userEvent.clear(qty);
    await userEvent.type(qty, "7");
    expect(within(ret).getByText("Only 6 available")).toBeInTheDocument();
    await userEvent.clear(qty);
    await userEvent.type(qty, "2");
    await userEvent.click(within(ret).getByRole("combobox", { name: "Reason" }));
    await userEvent.click(screen.getByRole("option", { name: "Damaged" }));
    await userEvent.click(within(ret).getByRole("button", { name: "Save" }));

    expect(mocks.ret).toHaveBeenCalledWith({
      fromType: "container",
      fromId: "c1",
      items: [{ productId: "p1", productName: "Deadbolt", quantity: 2 }],
      reason: ReturnReason.DAMAGED,
    });
  });

  it("hides the Actions column from someone who may not move stock", async () => {
    mocks.denied.add("transfers.create");
    open();
    await screen.findByText("Deadbolt");
    expect(headers()).toEqual(["Product Name", "Quantity", "Price", "Cost"]);
    expect(screen.queryByRole("button", { name: /Deadbolt/ })).toBeNull();
  });
});

describe("LocationStockDialog — search and paging, in the browser", () => {
  beforeEach(() => {
    const many = Array.from({ length: 23 }, (_, i) =>
      row(`x${i}`, `Part ${String(i + 1).padStart(2, "0")}`, 1, { sku: `P-${i + 1}` }),
    );
    vanRows = [...vanRows, ...many];
  });

  it("pages ten at a time with Workiz's footer", async () => {
    open();
    await screen.findByText("Deadbolt");
    expect(bodyRows()).toHaveLength(10);
    expect(screen.getByText("Showing 1 to 10 of 25 results")).toBeInTheDocument();
    expect(screen.getByText("Page 1 of 3")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Next page" }));
    expect(screen.getByText("Showing 11 to 20 of 25 results")).toBeInTheDocument();
  });

  it("searches by name or SKU and starts again from page 1", async () => {
    open();
    await screen.findByText("Deadbolt");
    await userEvent.click(screen.getByRole("button", { name: "Next page" }));
    await userEvent.type(screen.getByRole("searchbox", { name: "Search items" }), "lock-");
    expect(bodyRows().map((r) => r[0])).toEqual(["DeadboltLow stock"]);
    expect(screen.getByText("Page 1 of 1")).toBeInTheDocument();
  });

  it("changes the page size, and remembers it for next time", async () => {
    open();
    await screen.findByText("Deadbolt");
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Rows per page" }), "25");
    expect(bodyRows()).toHaveLength(25);
    expect(localStorage.getItem("bitcrm.page-size.stock-popup")).toBe("25");
  });

  it("says so when nothing matches", async () => {
    open();
    await screen.findByText("Deadbolt");
    await userEvent.type(screen.getByRole("searchbox", { name: "Search items" }), "zzz");
    expect(screen.getByText("No Records Found")).toBeInTheDocument();
  });
});

describe("LocationStockDialog — a warehouse, the same popup", () => {
  it("shows the warehouse's shelf, moves out of the warehouse", async () => {
    open("warehouse");
    expect(await screen.findByRole("dialog", { name: "Manage stock: Main" })).toBeInTheDocument();
    await screen.findByText("Strike plate");
    expect(screen.getByText("Total Items On Hand: 40")).toBeInTheDocument();
    expect(screen.getByText("Sale Items Value: 480.00")).toBeInTheDocument();
    expect(mocks.urls).toEqual(["/inventory/stock/locations/warehouse/w1"]);

    await userEvent.click(screen.getByRole("button", { name: "Return Strike plate from Main" }));
    const ret = screen.getByRole("dialog", { name: "Item return" });
    await userEvent.click(within(ret).getByRole("combobox", { name: "Reason" }));
    await userEvent.click(screen.getByRole("option", { name: "Recall" }));
    await userEvent.type(within(ret).getByLabelText("Quantity"), "1");
    await userEvent.click(within(ret).getByRole("button", { name: "Save" }));
    expect(mocks.ret).toHaveBeenCalledWith(
      expect.objectContaining({ fromType: "warehouse", fromId: "w1", reason: ReturnReason.RECALL }),
    );
  });
});

describe("LocationStockDialog — nothing there, or nothing readable", () => {
  it("says so for an empty van", async () => {
    vanRows = [];
    open();
    expect(await screen.findByText("Nothing in stock here")).toBeInTheDocument();
    expect(screen.getByText("Total Items On Hand: 0")).toBeInTheDocument();
  });

  it("offers Retry when the stock can't be read", async () => {
    server.use(
      http.get("*/inventory/stock/locations/container/c1", () =>
        HttpResponse.json({ success: false, message: "boom" }, { status: 500 }),
      ),
    );
    open();
    expect(await screen.findByText("Couldn't load stock")).toBeInTheDocument();
    server.use(
      http.get("*/inventory/stock/locations/container/c1", () =>
        HttpResponse.json(view("container", "c1", "Taras's van", [row("p1", "Deadbolt", 6)])),
      ),
    );
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(screen.getByText("Deadbolt")).toBeInTheDocument());
  });

  it("says the van is gone for a stale link", async () => {
    server.use(
      http.get("*/inventory/stock/locations/container/c404", () =>
        HttpResponse.json({ success: false, message: "Container not found" }, { status: 404 }),
      ),
    );
    open("container", "c404");
    expect(await screen.findByRole("dialog", { name: "Container not found" })).toBeInTheDocument();
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
  });

  it("shows no value when the server sent no prices", async () => {
    vanRows = [row("p1", "Deadbolt", 6)];
    open();
    await screen.findByText("Deadbolt");
    expect(screen.getByText("Sale Items Value: —")).toBeInTheDocument();
  });
});

/**
 * Workiz's sheet covers the window from the first frame, and its grid is
 * never shorter than ten rows: loading, a short page and the last page all
 * keep the pager where it is.
 */
describe("LocationStockDialog — nothing jumps", () => {
  it("covers the window the same loading and loaded", async () => {
    open();
    const loading = screen.getByRole("dialog").className;
    expect(screen.getByTestId("location-stock-loading")).toBeInTheDocument();
    await screen.findByText("Deadbolt");
    expect(screen.getByRole("dialog").className).toBe(loading);
    expect(loading).toMatch(/(^|\s)h-dvh(\s|$)/);
  });

  it("loading, already has the search, the rows-per-page and the grid's header over Workiz's loader", () => {
    open();
    const panel = screen.getByTestId("location-stock-loading");
    expect(within(panel).getByRole("searchbox", { name: "Search items" })).toBeDisabled();
    expect(within(panel).getByRole("combobox", { name: "Rows per page" })).toBeInTheDocument();
    expect(within(panel).getByRole("status", { name: "Loading" })).toBeInTheDocument();
  });

  it("keeps the grid ten rows tall on a short last page, so the pager stays put", async () => {
    vanRows = [...vanRows, ...Array.from({ length: 10 }, (_, i) => row(`y${i}`, `Bolt ${i}`, 1))];
    open();
    await screen.findByText("Deadbolt");
    const all = () => document.querySelectorAll('[role="dialog"] tbody tr').length;
    expect(all()).toBe(10);
    await userEvent.click(screen.getByRole("button", { name: "Next page" }));
    expect(bodyRows()).toHaveLength(2);
    expect(all()).toBe(10);
  });
});
