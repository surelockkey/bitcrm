import { afterEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { InventoryStatus, ProductType, type Product } from "@bitcrm/types";
import { duplicates, installFakeServer, renderWithClient, screen, settle } from "@/test/page-load";
import type { EstimateItemBody } from "@/features/estimates/schemas";

// Whether the viewer is a technician — who sets any price, as the office does.
const viewer = vi.hoisted(() => ({ technician: false }));
vi.mock("@/features/auth/use-permissions", () => ({
  usePermissions: () => ({ isTechnician: viewer.technician, can: () => true }),
}));

import { ProductPickerDialog } from "./product-picker-dialog";

const product = (over: Partial<Product>): Product =>
  ({
    id: "p1", name: "Deadbolt", sku: "DB-1", type: ProductType.PRODUCT, status: InventoryStatus.ACTIVE,
    costCompany: 20, costTech: 25, priceClient: 100, taxable: true, ...over,
  }) as Product;

/**
 * A catalog bigger than one page (the real one is ~7 300 active items over
 * 73 pages of 100): the named items first, then enough filler to need a
 * second page under any page size the picker may ask for.
 */
const catalog: Product[] = [
  product({}),
  product({ id: "p2", name: "Rekey service", sku: "SVC-1", type: ProductType.SERVICE, taxable: false, priceClient: 50 }),
  product({ id: "p3", name: "Old lock", sku: "OLD", status: InventoryStatus.ARCHIVED }),
  ...Array.from({ length: 117 }, (_, k) => product({ id: `f${k}`, name: `Filler item ${k}`, sku: `F-${k}` })),
];

const group = {
  id: "g1",
  name: "Front door kit",
  description: "",
  groupType: "separate_items",
  active: true,
  total: 255,
  members: [
    { productId: "p1", name: "Deadbolt (group)", quantity: 2, priceClient: 90, taxable: true, description: "", customAttributes: {} },
    { productId: "p2", name: "Install", quantity: 1, priceClient: 75, taxable: false, description: "Per door", customAttributes: {} },
  ],
};

/**
 * The inventory API as the picker sees it: a cursor-paged `GET
 * /inventory/products` that narrows by `status` and `search` (name or SKU,
 * any case) the way the server does, one item by id, and the item groups.
 */
function catalogServer() {
  return installFakeServer([
    {
      match: /\/inventory\/products$/,
      raw: true,
      reply: (url) => {
        const q = url.searchParams;
        const status = q.get("status");
        const term = (q.get("search") ?? "").trim().toLowerCase();
        const limit = Number(q.get("limit") ?? 20);
        const start = Number(q.get("cursor") ?? 0);
        const rows = catalog.filter(
          (p) => (!status || p.status === status) && (!term || `${p.name} ${p.sku}`.toLowerCase().includes(term)),
        );
        const page = rows.slice(start, start + limit);
        const next = start + limit < rows.length ? String(start + limit) : undefined;
        return { success: true, data: page, pagination: { count: page.length, ...(next && { nextCursor: next }) } };
      },
    },
    {
      match: /\/inventory\/products\/[^/]+$/,
      reply: (url) => catalog.find((p) => p.id === url.pathname.split("/").pop()) ?? null,
    },
    { match: /\/inventory\/item-groups$/, reply: () => [group] },
  ]);
}

/** The requests that read the catalog list (any page, any search). */
const listRequests = (requests: string[]) => requests.filter((r) => /\/inventory\/products\?/.test(r));

/**
 * The estimate page around the picker: it opens it from its own "Add item"
 * and, once a line is added, closes it by its own state — without going
 * through the dialog's onOpenChange, exactly as DocumentItemsTable does.
 */
function EstimatePage({ onSubmit }: { onSubmit: (body: EstimateItemBody) => void }) {
  const [adding, setAdding] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setAdding(true)}>
        Add item
      </button>
      <ProductPickerDialog
        open={adding}
        onOpenChange={(v) => {
          if (!v) setAdding(false);
        }}
        onSubmit={(body) => {
          onSubmit(body);
          setAdding(false);
        }}
      />
    </>
  );
}

const user = () => userEvent.setup({ pointerEventsCheck: 0 });

afterEach(() => {
  vi.unstubAllGlobals();
  viewer.technician = false;
});

describe("ProductPickerDialog", () => {
  it("lists the active catalog and asks the server for what is typed (name or SKU)", async () => {
    const server = catalogServer();
    renderWithClient(<ProductPickerDialog open onOpenChange={() => {}} onSubmit={() => {}} />);
    expect(await screen.findByText("Deadbolt")).toBeInTheDocument();
    expect(screen.queryByText("Old lock")).not.toBeInTheDocument();

    await user().type(screen.getByPlaceholderText(/search catalog/i), "svc");

    await waitFor(() => expect(screen.queryByText("Deadbolt")).not.toBeInTheDocument());
    expect(screen.getByText("Rekey service")).toBeInTheDocument();
    // One search for the settled text, not one per keystroke.
    expect(listRequests(server.requests).filter((r) => /search=/.test(r))).toEqual([
      expect.stringMatching(/search=svc/),
    ]);
  });

  // QA 2026-10-14 (web-flows 4.4, 5.3): "Loading catalog…" for 18–28 s on
  // every open — the whole catalog was paged into the browser, 100 at a time.
  it("reads one page of the catalog on open, keeps it for the next open and never drains the rest", async () => {
    const server = catalogServer();
    renderWithClient(<EstimatePage onSubmit={() => {}} />);
    const u = user();

    await u.click(screen.getByRole("button", { name: "Add item" }));
    expect(await screen.findByText("Deadbolt")).toBeInTheDocument();
    await settle();
    expect(listRequests(server.requests)).toHaveLength(1);
    expect(listRequests(server.requests)[0]).toMatch(/status=active/);
    expect(listRequests(server.requests)[0]).not.toMatch(/cursor=/);
    // More than a page exists: the picker says so instead of reading it all.
    expect(screen.getByText(/type to narrow/i)).toBeInTheDocument();

    await u.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await u.click(screen.getByRole("button", { name: "Add item" }));

    // Instant: the page's catalog, no loader, no request.
    expect(screen.getByText("Deadbolt")).toBeInTheDocument();
    expect(screen.queryByText(/loading catalog/i)).toBeNull();
    await settle();
    expect(listRequests(server.requests)).toHaveLength(1);
    expect(duplicates(server.requests)).toEqual([]);
  });

  // QA 2026-10-14 (web-flows 4.6): the second "Add item" opened on the
  // previous product's "Add to estimate" step — the page had closed the
  // picker itself, so the picker's own reset never ran.
  it("starts every open at the search step, empty, after the page closed it on a line added", async () => {
    catalogServer();
    const onSubmit = vi.fn();
    renderWithClient(<EstimatePage onSubmit={onSubmit} />);
    const u = user();

    await u.click(screen.getByRole("button", { name: "Add item" }));
    await u.type(await screen.findByLabelText("Search catalog"), "dead");
    await u.click(await screen.findByText("Deadbolt"));
    expect(screen.getByText("Add to estimate")).toBeInTheDocument();
    await u.click(within(screen.getByRole("dialog")).getByRole("button", { name: /^add item$/i }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    await u.click(screen.getByRole("button", { name: "Add item" }));

    expect(screen.getByText("Add an item")).toBeInTheDocument();
    expect(screen.queryByText("Add to estimate")).toBeNull();
    expect(screen.getByLabelText("Search catalog")).toHaveValue("");
    expect(await screen.findByText("Rekey service")).toBeInTheDocument();
  });

  it("reads an edited line's item by id — not the catalog — for its catalog price", async () => {
    const server = catalogServer();
    renderWithClient(
      <ProductPickerDialog
        open
        onOpenChange={() => {}}
        onSubmit={() => {}}
        editing={{ productId: "p1", name: "Deadbolt", sku: "DB-1", quantity: 2, priceClient: 90, costCompany: 20, costForTech: 25, taxable: true }}
      />,
    );
    expect(await screen.findByText(/catalog \$100\.00/)).toBeInTheDocument();
    expect(screen.getByDisplayValue("90")).toBeInTheDocument();
    await settle();
    expect(server.requests.filter((r) => r.includes("/inventory/products"))).toEqual([
      expect.stringMatching(/\/inventory\/products\/p1$/),
    ]);
  });

  it("configures and submits a line with the catalog's taxable default", async () => {
    catalogServer();
    const onSubmit = vi.fn();
    renderWithClient(<ProductPickerDialog open onOpenChange={() => {}} onSubmit={onSubmit} />);
    const u = user();
    await u.click(await screen.findByText("Rekey service"));
    const qty = screen.getByLabelText("Quantity");
    await u.clear(qty);
    await u.type(qty, "3");
    await u.type(screen.getByLabelText(/description/i), "Front and back");
    await u.click(screen.getByRole("button", { name: /^add item$/i }));
    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith({
        productId: "p2", productType: ProductType.SERVICE, name: "Rekey service", sku: "SVC-1",
        description: "Front and back", quantity: 3, priceClient: 50, costCompany: 20, costForTech: 25,
        taxable: false,
      }),
    );
  });

  it("offers no item groups unless the page can take one", async () => {
    catalogServer();
    renderWithClient(<ProductPickerDialog open onOpenChange={() => {}} onSubmit={() => {}} />);
    expect(await screen.findByText("Deadbolt")).toBeInTheDocument();
    expect(screen.queryByText("Front door kit")).not.toBeInTheDocument();
  });

  it("adds an item group's lines — the group's numbers, the price book's SKU and costs (Workiz: groups on estimates)", async () => {
    catalogServer();
    const onAddGroup = vi.fn();
    renderWithClient(
      <ProductPickerDialog open onOpenChange={() => {}} onSubmit={() => {}} onAddGroup={onAddGroup} />,
    );
    const u = user();
    await u.click(await screen.findByRole("button", { name: /Front door kit/ }));
    expect(screen.getByText("2 × $90.00")).toBeInTheDocument();
    // The members' items are read by id; the button waits for them.
    await waitFor(() => expect(screen.getByRole("button", { name: "Add group" })).toBeEnabled());
    await u.click(screen.getByRole("button", { name: "Add group" }));

    expect(onAddGroup).toHaveBeenCalledWith([
      {
        productId: "p1", productType: ProductType.PRODUCT, name: "Deadbolt (group)", sku: "DB-1",
        quantity: 2, priceClient: 90, costCompany: 20, costForTech: 25, taxable: true,
      },
      {
        productId: "p2", productType: ProductType.SERVICE, name: "Install", sku: "SVC-1", description: "Per door",
        quantity: 1, priceClient: 75, costCompany: 20, costForTech: 25, taxable: false,
      },
    ]);
  });

  // Owner, 2026-10-15: no ±15% band — a technician sets any price, as the office does.
  it("lets a technician set any price", async () => {
    catalogServer();
    viewer.technician = true;
    const onSubmit = vi.fn();
    renderWithClient(<ProductPickerDialog open onOpenChange={() => {}} onSubmit={onSubmit} />);
    const u = user();
    await u.click(await screen.findByText("Deadbolt"));
    const price = screen.getByLabelText("Client price");
    await u.clear(price);
    await u.type(price, "200");
    expect(screen.queryByText(/allowed|±15|band/i)).toBeNull();
    await u.click(screen.getByRole("button", { name: /^add item$/i }));
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ productId: "p1", priceClient: 200 });
  });

  it("takes a price below zero — a credit line — and shows its amount as -$20.00", async () => {
    catalogServer();
    viewer.technician = true;
    const onSubmit = vi.fn();
    renderWithClient(<ProductPickerDialog open onOpenChange={() => {}} onSubmit={onSubmit} />);
    const u = user();
    await u.click(await screen.findByText("Deadbolt"));
    const price = screen.getByLabelText("Client price");
    expect(price).not.toHaveAttribute("min");
    await u.clear(price);
    await u.type(price, "-20");
    expect(screen.queryByText(/negative/i)).toBeNull();
    expect(screen.getByText("-$20.00")).toBeInTheDocument();
    await u.click(screen.getByRole("button", { name: /^add item$/i }));
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ productId: "p1", priceClient: -20 });
  });

  it("lets the office set any price", async () => {
    catalogServer();
    const onSubmit = vi.fn();
    renderWithClient(<ProductPickerDialog open onOpenChange={() => {}} onSubmit={onSubmit} />);
    const u = user();
    await u.click(await screen.findByText("Deadbolt"));
    const price = screen.getByLabelText("Client price");
    await u.clear(price);
    await u.type(price, "200");
    expect(screen.queryByText(/allowed|±15|band/i)).toBeNull();
    await u.click(screen.getByRole("button", { name: /^add item$/i }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ productId: "p1", priceClient: 200 });
  });
});
