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

const card = (label: string) => screen.getByRole("group", { name: label });
const bodyRows = () =>
  [...document.querySelectorAll('[role="dialog"] tbody tr')].map((tr) =>
    [...tr.querySelectorAll("td")].map((td) => td.textContent),
  );
const headers = () =>
  [...document.querySelectorAll('[role="dialog"] thead th')].map((th) => th.textContent);

describe("LocationStockDialog — a van's stock", () => {
  it("is titled with the van's name", async () => {
    open();
    expect(await screen.findByRole("dialog", { name: "Taras's van — stock" })).toBeInTheDocument();
  });

  it("lists what the van holds — item, SKU, quantity — left-aligned", async () => {
    open();
    await screen.findByText("Deadbolt");
    expect(headers()).toEqual(["Item", "SKU", "Quantity", "Actions"]);
    expect(bodyRows().map((r) => r.slice(0, 2))).toEqual([
      ["Deadbolt", "LOCK-001"],
      ["Key blank", "KEY-7"],
    ]);
    for (const cell of document.querySelectorAll('[role="dialog"] th, [role="dialog"] td')) {
      expect(cell.className).not.toMatch(/text-right/);
    }
  });

  it("scrolls the table sideways instead of clipping it", async () => {
    open();
    await screen.findByText("Deadbolt");
    const frame = document.querySelector('[role="dialog"] [data-slot=table-frame]') as HTMLElement;
    expect(frame).not.toBeNull();
    expect(frame.className).toMatch(/overflow-x-auto/);
    expect(frame.className).not.toMatch(/overflow-hidden/);
  });

  // F2 answers in name order; sorting again would be work, and wrong if the
  // server ever orders on something the browser can't see.
  it("keeps the server's order", async () => {
    vanRows = [row("p2", "Key blank", 1), row("p1", "Deadbolt", 1)];
    open();
    await screen.findByText("Deadbolt");
    expect(bodyRows().map((r) => r[0])).toEqual(["Key blank", "Deadbolt"]);
  });

  it("marks an item that has run low", async () => {
    open();
    await screen.findByText("Deadbolt");
    expect(bodyRows()[0][2]).toBe("6Low");
    expect(bodyRows()[1][2]).toBe("120");
  });

  it("counts SKUs and units and prices them at the client price", async () => {
    open();
    await screen.findByText("Deadbolt");
    expect(card("SKUs")).toHaveTextContent("2");
    expect(card("Units")).toHaveTextContent("126");
    expect(card("Value")).toHaveTextContent("$630.00");
  });

  // The popup took over eight seconds on dev: it paged the whole
  // stock-managed catalog (3 102 items, 32 requests) to name the rows.
  it("reads the van in one request — no catalog, no container lookup", async () => {
    open();
    await screen.findByText("Deadbolt");
    expect(mocks.urls).toEqual(["/inventory/stock/locations/container/c1"]);
  });

  // The Containers tab puts the van's template strip here.
  it("shows what the page puts above the stock", async () => {
    renderWithClient(
      <LocationStockDialog
        type="container"
        locationId="c1"
        open
        onOpenChange={vi.fn()}
        aside={<div>Template strip</div>}
      />,
    );
    await screen.findByText("Deadbolt");
    expect(screen.getByText("Template strip")).toBeInTheDocument();
  });

  it("closes from the yellow Done", async () => {
    const { onOpenChange } = open();
    await screen.findByText("Deadbolt");
    const done = screen.getByRole("button", { name: "Done" });
    expect(done).toHaveAttribute("data-variant", "default");
    await userEvent.click(done);
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
    const move = screen.getByRole("dialog", { name: "Move Deadbolt from Taras's van" });
    await userEvent.click(within(move).getByRole("combobox", { name: "To location" }));
    await userEvent.click(screen.getByRole("option", { name: /Pavlo's van/ }));
    const qty = within(move).getByLabelText("Quantity");
    await userEvent.clear(qty);
    await userEvent.type(qty, "4");
    await userEvent.click(within(move).getByRole("button", { name: "Move" }));

    expect(mocks.move).toHaveBeenCalledWith({
      fromType: "container",
      fromId: "c1",
      toType: "container",
      toId: "c2",
      items: [{ productId: "p1", productName: "Deadbolt", quantity: 4 }],
    });
    // Only the small dialog closes; the van's popup stays.
    expect(screen.getByRole("dialog", { name: "Taras's van — stock" })).toBeInTheDocument();
  });

  it("returns out of this van with a reason, no more than it holds", async () => {
    open();
    await userEvent.click(await screen.findByRole("button", { name: "Return Deadbolt from Taras's van" }));
    const ret = screen.getByRole("dialog", { name: "Return Deadbolt from Taras's van" });
    const qty = within(ret).getByLabelText("Quantity");
    await userEvent.clear(qty);
    await userEvent.type(qty, "7");
    expect(within(ret).getByText("Only 6 available")).toBeInTheDocument();
    await userEvent.clear(qty);
    await userEvent.type(qty, "2");
    await userEvent.click(within(ret).getByRole("combobox", { name: "Reason" }));
    await userEvent.click(screen.getByRole("option", { name: "Damaged" }));
    await userEvent.click(within(ret).getByRole("button", { name: "Return" }));

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
    expect(headers()).toEqual(["Item", "SKU", "Quantity"]);
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
    expect(bodyRows().map((r) => r[0])).toEqual(["Deadbolt"]);
    expect(screen.getByText("Page 1 of 1")).toBeInTheDocument();
  });

  it("changes the page size", async () => {
    open();
    await screen.findByText("Deadbolt");
    await userEvent.click(screen.getByRole("combobox", { name: "Rows per page" }));
    await userEvent.click(screen.getByRole("option", { name: "25" }));
    expect(bodyRows()).toHaveLength(25);
  });

  it("says so when nothing matches", async () => {
    open();
    await screen.findByText("Deadbolt");
    await userEvent.type(screen.getByRole("searchbox", { name: "Search items" }), "zzz");
    expect(screen.getByText("No items match “zzz”.")).toBeInTheDocument();
  });
});

describe("LocationStockDialog — a warehouse, the same popup", () => {
  it("shows the warehouse's shelf, moves out of the warehouse", async () => {
    open("warehouse");
    expect(await screen.findByRole("dialog", { name: "Main — stock" })).toBeInTheDocument();
    await screen.findByText("Strike plate");
    expect(card("Units")).toHaveTextContent("40");
    expect(card("Value")).toHaveTextContent("$480.00");
    expect(mocks.urls).toEqual(["/inventory/stock/locations/warehouse/w1"]);

    await userEvent.click(screen.getByRole("button", { name: "Return Strike plate from Main" }));
    const ret = screen.getByRole("dialog", { name: "Return Strike plate from Main" });
    await userEvent.click(within(ret).getByRole("combobox", { name: "Reason" }));
    await userEvent.click(screen.getByRole("option", { name: "Recall" }));
    await userEvent.click(within(ret).getByRole("button", { name: "Return" }));
    expect(mocks.ret).toHaveBeenCalledWith(
      expect.objectContaining({ fromType: "warehouse", fromId: "w1", reason: ReturnReason.RECALL }),
    );
  });
});

describe("LocationStockDialog — nothing there, or nothing readable", () => {
  it("says so for an empty van", async () => {
    vanRows = [];
    open();
    expect(await screen.findByText("Nothing in stock here.")).toBeInTheDocument();
    expect(card("SKUs")).toHaveTextContent("0");
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
    expect(card("Value")).toHaveTextContent("—");
  });
});

/**
 * A centred popup that changes height moves both its edges: on load, on each
 * search keystroke, on a short last page. This one is its final height from
 * the first frame, and its loading state already has the toolbar and the pager.
 */
describe("LocationStockDialog — nothing jumps", () => {
  it("is the same height loading and loaded", async () => {
    open();
    const loading = screen.getByRole("dialog").className;
    expect(screen.getByTestId("location-stock-loading")).toBeInTheDocument();
    await screen.findByText("Deadbolt");

    expect(screen.getByRole("dialog").className).toBe(loading);
    expect(loading).toMatch(/(^|\s)h-\[/);
  });

  it("loading, already has the search, the rows-per-page and the pager in place", () => {
    open();
    const panel = screen.getByTestId("location-stock-loading");
    expect(within(panel).getByRole("searchbox", { name: "Search items" })).toBeDisabled();
    expect(within(panel).getByRole("combobox", { name: "Rows per page" })).toBeInTheDocument();
    expect(within(panel).getByTestId("panel-pager-placeholder")).toBeInTheDocument();
    expect(within(panel).getAllByTestId("skeleton-row").length).toBeGreaterThan(0);
  });

  it("keeps the table a page tall on a short last page, so the pager stays put", async () => {
    vanRows = [
      ...vanRows,
      ...Array.from({ length: 10 }, (_, i) => row(`y${i}`, `Bolt ${i}`, 1)),
    ];
    open();
    await screen.findByText("Deadbolt");
    const frame = () => document.querySelector('[role="dialog"] [data-slot=table-frame]') as HTMLElement;
    const full = frame().style.minHeight;
    expect(full).not.toBe("");

    await userEvent.click(screen.getByRole("button", { name: "Next page" }));
    expect(bodyRows()).toHaveLength(2);
    expect(frame().style.minHeight).toBe(full);
  });

  it("remembers the rows per page for next time", async () => {
    vanRows = [...vanRows, ...Array.from({ length: 30 }, (_, i) => row(`z${i}`, `Nut ${i}`, 1))];
    open();
    await screen.findByText("Deadbolt");
    await userEvent.click(screen.getByRole("combobox", { name: "Rows per page" }));
    await userEvent.click(screen.getByRole("option", { name: "25" }));
    expect(localStorage.getItem("bitcrm.page-size.stock-popup")).toBe("25");
  });
});
