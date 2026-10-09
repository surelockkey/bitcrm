import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { InventoryStatus, ProductType } from "@bitcrm/types";
import type { Product, ProductLocationStock, ProductStock } from "@bitcrm/types";
import { renderWithClient } from "@/test/render-with-client";

type Mutate = (vars: unknown, opts?: { onSuccess?: () => void }) => void;
type Query<T> = { isLoading: boolean; isError: boolean; data: T | undefined; refetch: () => void };

const mocks = vi.hoisted(() => ({
  denied: new Set<string>(),
  product: undefined as unknown as Query<Product>,
  stock: undefined as unknown as Query<ProductStock>,
  stockCalls: [] as [string, boolean][],
  receive: vi.fn(),
}));

vi.mock("@/features/auth/use-permissions", () => ({
  useDenied: () => () => false,
  usePermissions: () => ({
    can: (resource: string, action = "view") => !mocks.denied.has(`${resource}.${action}`),
  }),
}));

vi.mock("@/features/inventory/products/hooks", () => ({
  useProduct: () => mocks.product,
  useProductStock: (id: string, enabled: boolean) => {
    mocks.stockCalls.push([id, enabled]);
    return mocks.stock;
  },
}));

// The action dialogs run for real on top of the popup; only the server is stubbed.
vi.mock("../hooks", () => ({
  useReceiveStock: () => ({
    isPending: false,
    mutate: ((vars, opts) => {
      mocks.receive(vars);
      opts?.onSuccess?.();
    }) as Mutate,
  }),
  useMoveStock: () => ({ isPending: false, mutate: vi.fn() }),
  useReturnStock: () => ({ isPending: false, mutate: vi.fn() }),
  useAllLocations: () => ({ data: [], isLoading: false, isError: false }),
}));

import { ManageStockDialog } from "./manage-stock-dialog";

const active = InventoryStatus.ACTIVE;

function product(over: Partial<Product> = {}): Product {
  return {
    id: "p1",
    number: 1042,
    sku: "LOCK-001",
    name: "Deadbolt",
    category: "Locks",
    type: ProductType.PRODUCT,
    costCompany: 20.16,
    costTech: 25,
    priceClient: 45,
    serialTracking: false,
    minimumStockLevel: 5,
    onHand: 369,
    status: active,
    createdAt: "",
    updatedAt: "",
    ...over,
  };
}

function row(over: Partial<ProductLocationStock>): ProductLocationStock {
  return { locationType: "container", locationId: "c", name: "Van", status: active, quantity: 0, ...over };
}

const LOCATIONS: ProductLocationStock[] = [
  row({ locationType: "warehouse", locationId: "w1", name: "Main", description: "Dallas yard", quantity: 300 }),
  row({ locationType: "warehouse", locationId: "w2", name: "Old yard", status: InventoryStatus.ARCHIVED, quantity: 0 }),
  row({ locationId: "c1", name: "Taras's van", description: "Ford Transit", quantity: 69 }),
];

function query<T>(data: T | undefined, over: Partial<Query<T>> = {}): Query<T> {
  return { isLoading: false, isError: false, data, refetch: vi.fn(), ...over };
}

function fleet(n: number): ProductLocationStock[] {
  return Array.from({ length: n }, (_, i) =>
    row({ locationId: `c${i + 1}`, name: `Van ${String(i + 1).padStart(3, "0")}`, quantity: 1 }),
  );
}

beforeEach(() => {
  mocks.denied = new Set();
  mocks.product = query(product());
  mocks.stock = query({ productId: "p1", onHand: 369, locations: LOCATIONS });
  mocks.stockCalls = [];
  mocks.receive.mockReset();
});

function open(props: Partial<Parameters<typeof ManageStockDialog>[0]> = {}) {
  const onOpenChange = vi.fn();
  renderWithClient(<ManageStockDialog productId="p1" open onOpenChange={onOpenChange} {...props} />);
  return { onOpenChange, dialog: () => screen.getByRole("dialog", { name: /Manage stock/ }) };
}

const card = (label: string) => screen.getByRole("group", { name: label });
const bodyRows = () =>
  [...document.querySelectorAll('[role="dialog"] tbody tr')].map((tr) =>
    [...tr.querySelectorAll("td")].map((td) => td.textContent),
  );
const headers = () =>
  [...document.querySelectorAll('[role="dialog"] thead th')].map((th) => th.textContent);

describe("ManageStockDialog — the Workiz popup", () => {
  // Workiz's item names carry their SKU already: "Manage stock - Don-Jo - Chain Guard - Silver (1607-625) (SLK-3551)".
  it("is titled \"Manage stock - <name>\", as Workiz titles it", () => {
    open();
    expect(screen.getByRole("dialog", { name: "Manage stock - Deadbolt" })).toBeInTheDocument();
  });

  it("reads the item's stock while open", () => {
    open();
    expect(mocks.stockCalls).toContainEqual(["p1", true]);
  });

  it("totals what is on hand, what it cost and what it sells for", () => {
    open();
    expect(card("Total on hand")).toHaveTextContent("369.00");
    expect(card("Total cost")).toHaveTextContent("$7439.04");
    expect(card("Sale value")).toHaveTextContent("$16605.00");
  });

  it("keeps the cost card from someone who may not see money", () => {
    mocks.denied.add("financials.view");
    open();
    expect(screen.queryByRole("group", { name: "Total cost" })).toBeNull();
    expect(screen.queryByText("$7439.04")).toBeNull();
    expect(card("Total on hand")).toHaveTextContent("369.00");
    expect(card("Sale value")).toHaveTextContent("$16605.00");
  });

  it("lists every location as the server orders it — warehouses first, archived too", () => {
    open();
    expect(headers()).toEqual(["Location", "Description", "Quantity", "Actions"]);
    const rows = bodyRows();
    expect(rows.map((r) => r[0])).toEqual(["Main", "Old yard (archived)", "Taras's van"]);
    expect(rows[0][1]).toBe("Dallas yard");
    expect(rows[1][1]).toBe("");
    // Whole units, not the cards' two decimals.
    expect(rows.map((r) => r[2])).toEqual(["300", "0", "69"]);
  });

  // react-table's rt-table: 41% of the window at most, the rows scrolling under the header.
  it("scrolls the table in its own box instead of clipping it", () => {
    open();
    const box = document.querySelector('[role="dialog"] table')!.parentElement as HTMLElement;
    expect(box.className).toMatch(/max-h-\[41vh\]/);
    expect(box.className).toMatch(/overflow-auto/);
  });

  it("left-aligns the table — numbers included", () => {
    open();
    const cells = document.querySelectorAll('[role="dialog"] th, [role="dialog"] td');
    for (const cell of cells) expect(cell.className).not.toMatch(/text-right/);
  });

  it("closes from the yellow Done", async () => {
    const { onOpenChange } = open();
    const done = screen.getByRole("button", { name: "Done" });
    expect(done).toHaveAttribute("data-variant", "primary");
    await userEvent.click(done);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});

describe("ManageStockDialog — search and paging, in the browser", () => {
  it("searches locations by name or description", async () => {
    open();
    await userEvent.type(screen.getByRole("searchbox", { name: "Search locations" }), "transit");
    expect(bodyRows().map((r) => r[0])).toEqual(["Taras's van"]);
    expect(screen.getByText("Showing 1 to 1 of 1 results")).toBeInTheDocument();
  });

  it("says so when nothing matches", async () => {
    open();
    await userEvent.type(screen.getByRole("searchbox", { name: "Search locations" }), "zzz");
    expect(screen.getByText("No rows found")).toBeInTheDocument();
    // react-table's own words on nothing (pg_inventory_wz_15_locations_search_empty).
    expect(screen.getByText("Showing 1 to 0 of 0 results")).toBeInTheDocument();
  });

  it("pages ten at a time with Workiz's footer", async () => {
    mocks.stock = query({ productId: "p1", onHand: 93, locations: fleet(93) });
    open();
    expect(bodyRows()).toHaveLength(10);
    expect(screen.getByText("Showing 1 to 10 of 93 results")).toBeInTheDocument();
    expect(screen.getByText("Page 1 of 10")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Previous page" })).toBeDisabled();

    await userEvent.click(screen.getByRole("button", { name: "Next page" }));
    expect(screen.getByText("Showing 11 to 20 of 93 results")).toBeInTheDocument();
    expect(screen.getByText("Page 2 of 10")).toBeInTheDocument();
    expect(bodyRows()[0][0]).toBe("Van 011");

    await userEvent.click(screen.getByRole("button", { name: "Previous page" }));
    expect(screen.getByText("Page 1 of 10")).toBeInTheDocument();
  });

  it("stops at the last page", async () => {
    mocks.stock = query({ productId: "p1", onHand: 12, locations: fleet(12) });
    open();
    await userEvent.click(screen.getByRole("button", { name: "Next page" }));
    expect(screen.getByText("Showing 11 to 12 of 12 results")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Next page" })).toBeDisabled();
  });

  it("changes the page size and starts again from page 1", async () => {
    mocks.stock = query({ productId: "p1", onHand: 93, locations: fleet(93) });
    open();
    await userEvent.click(screen.getByRole("button", { name: "Next page" }));

    const size = screen.getByRole("combobox", { name: "Rows per page" });
    expect(within(size).getAllByRole("option").map((o) => o.textContent)).toEqual(["5", "10", "20", "25", "50", "100"]);
    await userEvent.selectOptions(size, "25");

    expect(bodyRows()).toHaveLength(25);
    expect(screen.getByText("Showing 1 to 25 of 93 results")).toBeInTheDocument();
    expect(screen.getByText("Page 1 of 4")).toBeInTheDocument();
  });

  it("goes back to page 1 when the search changes", async () => {
    mocks.stock = query({ productId: "p1", onHand: 93, locations: fleet(93) });
    open();
    await userEvent.click(screen.getByRole("button", { name: "Next page" }));
    await userEvent.type(screen.getByRole("searchbox", { name: "Search locations" }), "Van 0");
    expect(screen.getByText("Page 1 of 10")).toBeInTheDocument();
    expect(bodyRows()[0][0]).toBe("Van 001");
  });
});

describe("ManageStockDialog — actions per location", () => {
  it("offers add, move and return on each row", () => {
    open();
    expect(screen.getByRole("button", { name: "Add Deadbolt to Main" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Move Deadbolt from Main" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Return Deadbolt from Main" })).toBeEnabled();
  });

  it("can't move or return from a location that holds none, and can still add to it", () => {
    mocks.stock = query({
      productId: "p1",
      onHand: 0,
      locations: [row({ locationId: "c2", name: "Pavlo's van", quantity: 0 })],
    });
    open();
    expect(screen.getByRole("button", { name: "Move Deadbolt from Pavlo's van" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Return Deadbolt from Pavlo's van" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Add Deadbolt to Pavlo's van" })).toBeEnabled();
  });

  // An archived location is no transfer target (the Move picker leaves it
  // out), so no new stock goes in — but what it still holds can get out.
  it("takes no new stock into an archived location, and lets what's there leave", () => {
    mocks.stock = query({
      productId: "p1",
      onHand: 7,
      locations: [
        row({
          locationType: "warehouse",
          locationId: "w2",
          name: "Old yard",
          status: InventoryStatus.ARCHIVED,
          quantity: 7,
        }),
      ],
    });
    open();
    expect(screen.getByRole("button", { name: "Add Deadbolt to Old yard" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Move Deadbolt from Old yard" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Return Deadbolt from Old yard" })).toBeEnabled();
  });

  // A location deleted in Workiz is listed only while it still holds the item:
  // no units go missing from the total, and they can be moved or returned.
  it("greys out a location deleted in Workiz, says so, and lets its units leave", () => {
    mocks.stock = query({
      productId: "p1",
      onHand: 4,
      locations: [
        row({
          locationId: "cz",
          name: "Van 9 (видалено у Workiz)",
          status: InventoryStatus.ARCHIVED,
          placeholder: true,
          quantity: 4,
        }),
      ],
    });
    open();
    const tr = screen.getByText("Van 9 (видалено у Workiz)").closest("tr") as HTMLElement;
    expect(tr).toHaveTextContent("(deleted in Workiz)");
    expect(tr).not.toHaveTextContent("(archived)");
    expect(tr.className).toMatch(/opacity-/);
    expect(screen.getByRole("button", { name: "Add Deadbolt to Van 9 (видалено у Workiz)" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Move Deadbolt from Van 9 (видалено у Workiz)" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Return Deadbolt from Van 9 (видалено у Workiz)" })).toBeEnabled();
  });

  it("has no add when opened with allowAdd={false}", () => {
    open({ allowAdd: false });
    expect(screen.queryByRole("button", { name: /^Add Deadbolt/ })).toBeNull();
    expect(screen.getByRole("button", { name: "Move Deadbolt from Main" })).toBeInTheDocument();
  });

  it("hides the Actions column from someone who may not move stock", () => {
    mocks.denied.add("transfers.create");
    open();
    expect(headers()).toEqual(["Location", "Description", "Quantity"]);
    expect(screen.queryByRole("button", { name: /Deadbolt/ })).toBeNull();
  });

  it("adds stock from a row and stays open on the item", async () => {
    const { onOpenChange } = open();
    await userEvent.click(screen.getByRole("button", { name: "Add Deadbolt to Taras's van" }));

    const add = screen.getByRole("dialog", { name: "Add items" });
    const qty = within(add).getByLabelText("Quantity");
    await userEvent.clear(qty);
    await userEvent.type(qty, "6");
    await userEvent.click(within(add).getByRole("button", { name: "Save" }));

    expect(mocks.receive).toHaveBeenCalledWith({
      toType: "container",
      toId: "c1",
      items: [{ productId: "p1", productName: "Deadbolt", quantity: 6 }],
    });
    expect(screen.queryByRole("dialog", { name: "Add items" })).toBeNull();
    expect(screen.getByRole("dialog", { name: /Manage stock/ })).toBeInTheDocument();
    expect(onOpenChange).not.toHaveBeenCalled();
  });
});

describe("ManageStockDialog — loading, errors, nothing yet", () => {
  it("shows the popup's own frame while loading — the cards, the controls, the header over Workiz's loader", () => {
    mocks.stock = query<ProductStock>(undefined, { isLoading: true });
    open();
    expect(card("Total on hand")).toBeInTheDocument();
    expect(screen.getByRole("searchbox", { name: "Search locations" })).toBeDisabled();
    expect(headers()).toEqual(["Location", "Description", "Quantity", "Actions"]);
    expect(screen.getByRole("status", { name: "Loading" })).toBeInTheDocument();
    expect(bodyRows()).toEqual([]);
  });

  it("is the same height loading and loaded", () => {
    mocks.stock = query<ProductStock>(undefined, { isLoading: true });
    const { unmount } = renderWithClient(<ManageStockDialog productId="p1" open onOpenChange={vi.fn()} />);
    const loading = screen.getByRole("dialog").className;
    unmount();

    mocks.stock = query({ productId: "p1", onHand: 369, locations: LOCATIONS });
    open();
    expect(screen.getByRole("dialog").className).toBe(loading);
    expect(loading).toMatch(/(^|\s)h-\[/);
  });

  it("offers Retry when the stock can't be read", async () => {
    mocks.stock = query<ProductStock>(undefined, { isError: true });
    open();
    expect(screen.getByText("Couldn't load stock")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(mocks.stock.refetch).toHaveBeenCalled();
  });

  it("offers Retry when the item can't be read", async () => {
    mocks.product = query<Product>(undefined, { isError: true });
    open();
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(mocks.product.refetch).toHaveBeenCalled();
  });

  it("says when there are no locations at all", () => {
    mocks.stock = query({ productId: "p1", onHand: 0, locations: [] });
    open();
    expect(screen.getByText("No warehouses or containers yet.")).toBeInTheDocument();
    expect(card("Total on hand")).toHaveTextContent("0.00");
  });

  it("renders nothing while closed", () => {
    renderWithClient(<ManageStockDialog productId="p1" open={false} onOpenChange={vi.fn()} />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
