import { afterEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { InventoryStatus, ProductType, UserContainerAccess, type Product } from "@bitcrm/types";
import { duplicates, installFakeServer, renderWithClient, screen, settle } from "@/test/page-load";

/*
 * The job's Add item dialog against the inventory API itself (a real
 * QueryClient on the app's defaults, a fake server at `fetch`): what it asks
 * for when it opens, and again when it opens again. Its forms and the ±15%
 * band are covered in add-product-dialog.test.tsx.
 */

const mocks = vi.hoisted(() => ({
  // The add mutation succeeds at once, so the dialog closes as in the app.
  add: vi.fn((_body: unknown, opts?: { onSuccess?: () => void }) => opts?.onSuccess?.()),
}));

vi.mock("../hooks", () => ({
  useAddProduct: () => ({ mutate: mocks.add, isPending: false }),
  useReplaceProduct: () => ({ mutate: vi.fn(), isPending: false }),
  useAddItemGroup: () => ({ mutate: vi.fn(), isPending: false }),
  useUserMap: () => ({
    map: new Map([["t1", { id: "t1", firstName: "Bob", lastName: "Wrench" }]]),
    users: [],
    isLoading: false,
  }),
}));

vi.mock("@/features/auth/use-permissions", () => ({
  usePermissions: () => ({ isTechnician: false, can: () => true }),
}));

import { AddProductDialog } from "./add-product-dialog";

const product = (over: Partial<Product>): Product =>
  ({
    id: "p1", name: "Kwikset Deadbolt", sku: "KW-1", type: ProductType.PRODUCT, status: InventoryStatus.ACTIVE,
    costCompany: 10, costTech: 15, priceClient: 45, taxable: true, ...over,
  }) as Product;

/** More than one page of active items, the named ones first. */
const catalog: Product[] = [
  product({}),
  product({ id: "p2", name: "Schlage Lever", sku: "SC-2", priceClient: 60 }),
  ...Array.from({ length: 118 }, (_, k) => product({ id: `f${k}`, name: `Filler item ${k}`, sku: `F-${k}` })),
];

function inventoryServer() {
  return installFakeServer([
    {
      match: /\/inventory\/products$/,
      raw: true,
      reply: (url) => {
        const q = url.searchParams;
        const term = (q.get("search") ?? "").trim().toLowerCase();
        const limit = Number(q.get("limit") ?? 20);
        const start = Number(q.get("cursor") ?? 0);
        const rows = catalog.filter((p) => !term || `${p.name} ${p.sku}`.toLowerCase().includes(term));
        const page = rows.slice(start, start + limit);
        const next = start + limit < rows.length ? String(start + limit) : undefined;
        return { success: true, data: page, pagination: { count: page.length, ...(next && { nextCursor: next }) } };
      },
    },
    { match: /\/inventory\/products\/[^/]+$/, reply: (url) => catalog.find((p) => p.id === url.pathname.split("/").pop()) ?? null },
    { match: /\/inventory\/item-groups$/, reply: () => [] },
    { match: /\/inventory\/user-containers\/t1$/, reply: () => ({ userId: "t1", access: UserContainerAccess.CONTAINER, containerId: "van1" }) },
    { match: /\/inventory\/stock\/locations\/container\/van1$/, reply: () => ({ rows: [{ productId: "p1", quantity: 5 }] }) },
  ]);
}

const listRequests = (requests: string[]) => requests.filter((r) => /\/inventory\/products\?/.test(r));

/** The job's Items tab around the dialog: opens it, and closes it when the dialog asks. */
function ItemsTab() {
  const [adding, setAdding] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setAdding(true)}>
        Add item
      </button>
      <AddProductDialog dealId="d1" techIds={["t1"]} open={adding} onOpenChange={setAdding} />
    </>
  );
}

const user = () => userEvent.setup({ pointerEventsCheck: 0 });

afterEach(() => vi.unstubAllGlobals());

describe("AddProductDialog — the catalog it reads", () => {
  // QA 2026-10-14 (web-flows 5.3): ~20–30 s of "Loading catalog…" on the
  // invoice's Add item — the whole catalog paged into the browser, 100 a time.
  it("reads one page on open, none on the next open, and starts at the search again", async () => {
    const server = inventoryServer();
    renderWithClient(<ItemsTab />);
    const u = user();

    await u.click(screen.getByRole("button", { name: "Add item" }));
    expect(await screen.findByText("Kwikset Deadbolt")).toBeInTheDocument();
    await settle();
    expect(listRequests(server.requests)).toHaveLength(1);
    expect(listRequests(server.requests)[0]).toMatch(/status=active/);
    expect(listRequests(server.requests)[0]).not.toMatch(/cursor=/);
    expect(screen.getByText(/type to narrow/i)).toBeInTheDocument();

    // A line goes on; the dialog closes itself.
    await u.type(screen.getByPlaceholderText(/search catalog/i), "kwik");
    await u.click(screen.getByText("Kwikset Deadbolt"));
    await u.click(screen.getByRole("button", { name: /^add$/i }));
    expect(mocks.add).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    await u.click(screen.getByRole("button", { name: "Add item" }));

    // Back at the search, empty, with the page's catalog at once.
    expect(screen.getByText("Add a product")).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/search catalog/i)).toHaveValue("");
    expect(screen.getByText("Schlage Lever")).toBeInTheDocument();
    expect(screen.queryByText(/loading catalog/i)).toBeNull();
    await settle();
    // The first page once; the word typed on the way to the line was never
    // searched (the line's own step took over before the typing settled).
    expect(listRequests(server.requests)).toHaveLength(1);
    expect(duplicates(server.requests)).toEqual([]);
  });

  it("sends what is typed to the server as the search and lists its answer, van stock first", async () => {
    const server = inventoryServer();
    renderWithClient(<AddProductDialog dealId="d1" techIds={["t1"]} open onOpenChange={() => {}} />);
    expect(await screen.findByText("Schlage Lever")).toBeInTheDocument();

    await user().type(screen.getByPlaceholderText(/search catalog/i), "lever");

    await waitFor(() => expect(screen.queryByText("Kwikset Deadbolt")).toBeNull());
    expect(screen.getByText("Schlage Lever")).toBeInTheDocument();
    expect(listRequests(server.requests).filter((r) => /search=/.test(r))).toEqual([expect.stringMatching(/search=lever/)]);
  });

  it("reads an edited line's item by id — not a catalog page", async () => {
    const server = inventoryServer();
    renderWithClient(
      <AddProductDialog
        dealId="d1"
        techIds={["t1"]}
        open
        onOpenChange={() => {}}
        editing={{
          lineId: "line-1", productId: "p2", name: "Schlage Lever", sku: "SC-2", quantity: 2,
          costCompany: 10, costForTech: 15, priceClient: 55, fulfillment: "sourced", sourceTechId: "t1", addedBy: "u1", addedAt: "",
        }}
      />,
    );
    expect(await screen.findByText(/catalog \$60\.00/)).toBeInTheDocument();
    expect(screen.getByDisplayValue("55")).toBeInTheDocument();
    await settle();
    expect(server.requests.filter((r) => r.includes("/inventory/products"))).toEqual([
      expect.stringMatching(/\/inventory\/products\/p2$/),
    ]);
  });
});
