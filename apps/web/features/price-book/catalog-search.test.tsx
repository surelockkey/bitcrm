import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { InventoryStatus, ProductType, type Product } from "@bitcrm/types";
import { QUERY_DEFAULTS } from "@/lib/query-defaults";
import { installFakeServer, settle } from "@/test/page-load";
import { CATALOG_PAGE_SIZE, useCatalogProduct, useCatalogProducts, useCatalogSearch } from "./catalog-search";

const product = (over: Partial<Product>): Product =>
  ({
    id: "p1", name: "Deadbolt", sku: "DB-1", type: ProductType.PRODUCT, status: InventoryStatus.ACTIVE,
    costCompany: 20, costTech: 25, priceClient: 100, taxable: true, ...over,
  }) as Product;

const catalog = [product({}), product({ id: "p2", name: "Rekey service", sku: "SVC-1", type: ProductType.SERVICE })];

function server() {
  return installFakeServer([
    {
      match: /\/inventory\/products$/,
      raw: true,
      reply: (url) => {
        const term = (url.searchParams.get("search") ?? "").toLowerCase();
        const data = catalog.filter((p) => !term || p.name.toLowerCase().includes(term));
        return { success: true, data, pagination: { count: data.length, nextCursor: "more" } };
      },
    },
    { match: /\/inventory\/products\/[^/]+$/, reply: (url) => catalog.find((p) => p.id === url.pathname.split("/").pop()) ?? null },
  ]);
}

/** A fresh QueryClient on the app's defaults (so the stale times are the browser's), minus retries. */
function wrapper() {
  const client = new QueryClient({
    defaultOptions: { ...QUERY_DEFAULTS, queries: { ...QUERY_DEFAULTS.queries, retry: false } },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  }
  return Wrapper;
}

afterEach(() => vi.unstubAllGlobals());

describe("useCatalogSearch", () => {
  it("asks for the first page of the active catalog at once, with no search, and says more exist", async () => {
    const fake = server();
    const { result } = renderHook(() => useCatalogSearch(""), { wrapper: wrapper() });
    expect(result.current.isLoading).toBe(true);
    await waitFor(() => expect(result.current.products).toHaveLength(2));
    expect(result.current.hasMore).toBe(true);
    expect(fake.requests).toEqual([expect.stringMatching(new RegExp(`/inventory/products\\?status=active&limit=${CATALOG_PAGE_SIZE}$`))]);
  });

  it("reads nothing while the search is not on screen", async () => {
    const fake = server();
    renderHook(() => useCatalogSearch("", false), { wrapper: wrapper() });
    await settle();
    expect(fake.requests).toEqual([]);
  });

  it("sends the text as `search` once it has settled — one request, not one per keystroke", async () => {
    const fake = server();
    const { result, rerender } = renderHook(({ text }) => useCatalogSearch(text), {
      wrapper: wrapper(),
      initialProps: { text: "" },
    });
    await waitFor(() => expect(result.current.products).toHaveLength(2));
    rerender({ text: "r" });
    rerender({ text: "re" });
    rerender({ text: "rekey " });
    // The last page stays (as a placeholder) while the search runs.
    expect(result.current.products).toHaveLength(2);
    await waitFor(() => expect(result.current.products.map((p) => p.id)).toEqual(["p2"]));
    expect(fake.requests.filter((r) => /search=/.test(r))).toEqual([
      expect.stringMatching(new RegExp(`/inventory/products\\?status=active&search=rekey&limit=${CATALOG_PAGE_SIZE}$`)),
    ]);
  });
});

describe("useCatalogProduct / useCatalogProducts", () => {
  it("reads one item by id, and nothing without an id", async () => {
    const fake = server();
    const { result, rerender } = renderHook(({ id }: { id?: string }) => useCatalogProduct(id), {
      wrapper: wrapper(),
      initialProps: {},
    });
    await settle();
    expect(fake.requests).toEqual([]);
    rerender({ id: "p1" });
    await waitFor(() => expect(result.current.data?.name).toBe("Deadbolt"));
    expect(fake.requests).toEqual([expect.stringMatching(/\/inventory\/products\/p1$/)]);
  });

  it("reads a group's members by id into a map, and is pending until every one answered", async () => {
    server();
    const { result } = renderHook(() => useCatalogProducts(["p1", "p2", "gone"]), { wrapper: wrapper() });
    expect(result.current.isPending).toBe(true);
    await waitFor(() => expect(result.current.isPending).toBe(false));
    expect([...result.current.map.keys()]).toEqual(["p1", "p2"]);
  });
});
