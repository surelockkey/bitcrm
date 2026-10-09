"use client";

import { useMemo, useState } from "react";
import { FileText, Plus, Upload } from "lucide-react";
import type { Product } from "@bitcrm/types";
import { Button } from "@/components/ui/button";
import { WzGroupedFilter } from "@/components/workiz/grouped-filter";
import { WZ_GRID_PAGE_SIZES } from "@/components/workiz/local-grid";
import { WzPager } from "@/components/workiz/pager";
import { WzListToolbar, WzPageSizeSelect, WzSearchBox, WzToolbarButton } from "@/components/workiz/toolbar";
import { useDenied, usePermissions } from "@/features/auth/use-permissions";
import { usePopup } from "@/features/inventory/use-popup";
import { useBrands, useItemCategories } from "@/features/inventory/products/hooks";
import { productsToCsv } from "@/features/inventory/products/lib";
import { ProductDialog } from "@/features/inventory/products/components/product-dialog";
import { ImportProductsDialog } from "@/features/inventory/products/components/import-products-dialog";
import { useDebouncedValue } from "@/lib/use-debounced-value";
import { settled, usePageReady } from "@/lib/use-page-ready";
import { pagedSource } from "@/lib/paging/paged-source";
import { usePageSize } from "@/lib/paging/use-page-size";
import { usePager } from "@/lib/paging/use-pager";
import { usePriceBookCount, usePriceBookItems } from "../hooks";
import { SHOW_DEFAULT, brandNameMap, normalizeShow, showGroups, toProductFilter, type ShowValue } from "../lib";
import { ITEMS_TABLE_KEY, ItemsTable } from "./items-table";

/** The popup over the list — one at a time: an item's Edit, or a new item. */
type ItemPopup = { kind: "edit"; id: string } | { kind: "new" };

/** Old links carried the popup in the query; they land on the plain list, the params dropped. */
const STALE_PARAMS = ["edit", "new"] as const;

/** Workiz's page size before the reader picks one. */
const DEFAULT_PAGE_SIZE = 10;

/**
 * Workiz's "Items & products" tab (`/root/service_and_products/1`,
 * pg_pricebook_wz_*): "Show:" over its grouped box (one chip, status: Active
 * items) with the yellow Add New at the right; the grey strip (Search, the
 * page size, Export — and BitCRM's Import beside it); the react-table grid
 * with the pager inside it. Every filter goes to the server; a page is never
 * filtered here. A row opens Workiz's "Edit Item", Add New its "Add New
 * Item" — the popups Inventory shares.
 *
 * It loads once: the rows wait for the permissions (they decide the Cost
 * column and the buttons), the count (the pager's "of N") and the brands
 * (the Brand column) and come in one frame; a new filter keeps the rows on
 * screen, dimmed, not a loader.
 */
export function ItemsPage() {
  const { can, isLoading: permsLoading } = usePermissions();
  const denied = useDenied();
  const money = can("financials", "view");
  // Until the permissions answer, every control is drawn (and off): a strip
  // that gained Import a moment in threw Export sideways.
  const canCreate = permsLoading || can("products", "create");
  const canCategories = permsLoading || can("product_categories", "view");
  const canBrands = permsLoading || can("brands", "view");

  const [show, setShow] = useState<ShowValue>(SHOW_DEFAULT);
  const [searchInput, setSearchInput] = useState("");
  const [importOpen, setImportOpen] = useState(false);

  const term = useDebouncedValue(searchInput.trim(), 300);
  const filter = useMemo(() => toProductFilter(show, term), [show, term]);

  const [pageSize, setPageSize] = usePageSize(ITEMS_TABLE_KEY, { sizes: WZ_GRID_PAGE_SIZES, fallback: DEFAULT_PAGE_SIZE });
  const query = usePriceBookItems(filter, pageSize);
  const count = usePriceBookCount(filter);
  // While the previous filter's rows stand in for the new ones their cursor
  // belongs to the old set — no paging through them.
  const src = pagedSource(query);
  const pager = usePager(query.isPlaceholderData ? { ...src, hasNextPage: false } : src, {
    total: count.data?.total,
    totalIsFloor: count.data?.atLeast,
    pageSize,
    resetKey: JSON.stringify({ filter, pageSize }),
  });
  const items = pager.items;

  // Every category and brand the catalogs know (archived too — items still
  // carry them). Asked for beside the permissions, not after them — the
  // server guards the catalogs.
  const categoryCatalog = useItemCategories(canCategories);
  const brandCatalog = useBrands(canBrands);

  const ready = usePageReady(
    !permsLoading && settled(query) && settled(count) && (!canBrands || settled(brandCatalog)),
  );
  const groups = useMemo(
    () =>
      showGroups({
        categories: categoryCatalog.data,
        brands: brandCatalog.data,
        canCategories: !permsLoading && can("product_categories", "view"),
        canBrands: !permsLoading && can("brands", "view"),
      }),
    [categoryCatalog.data, brandCatalog.data, permsLoading, can],
  );
  const brandNames = useMemo(() => brandNameMap(brandCatalog.data), [brandCatalog.data]);

  // Popups are state: a row opens one and the address stays.
  const { popup, open, close } = usePopup<ItemPopup>(STALE_PARAMS);
  const editId = popup?.kind === "edit" ? popup.id : null;
  const creating = popup?.kind === "new";

  if (denied("products")) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
        <h2 className="text-lg font-medium">No access</h2>
        <p className="text-sm text-muted-foreground">You don&apos;t have permission to view items.</p>
      </div>
    );
  }

  return (
    // The frame drawn while the permissions load is a guess at what they
    // allow; once they answer it is drawn anew, not reshuffled.
    <div key={permsLoading ? "guess" : "known"} className="flex flex-col">
      {/* "Show:" 19px under the tab rule, the box 8px under it (780×48.64 at
          1400), Add New level with the box 20px from the edge; the strip
          193px under the rule — the room Workiz keeps for its bulk row. */}
      <div className="min-h-[193px] shrink-0 px-5 pt-[19px]">
        <div className="mb-2 text-[12.6px] leading-4 font-bold text-[#4d4d4d]">Show:</div>
        <div className="flex items-start justify-between gap-5">
          <WzGroupedFilter
            aria-label="Show"
            size="tall"
            className="w-[57.4%] min-w-0"
            groups={groups}
            value={show}
            onChange={(next) => setShow((prev) => normalizeShow(prev, next))}
          />
          {canCreate ? (
            <Button disabled={permsLoading} onClick={() => open({ kind: "new" })}>
              <Plus />
              Add New
            </Button>
          ) : null}
        </div>
      </div>

      {/* The grey strip: Search; the page size, Export and ours, Import, at the right. */}
      <WzListToolbar data-testid="price-book-toolbar" className="shrink-0">
        <WzSearchBox value={searchInput} onChange={setSearchInput} maxLength={100} />
        <div className="ml-auto flex items-center gap-4">
          <WzPageSizeSelect value={pageSize} sizes={WZ_GRID_PAGE_SIZES} onChange={setPageSize} />
          <WzToolbarButton
            title="Export CSV"
            disabled={!ready || items.length === 0}
            onClick={() => downloadCsv(productsToCsv(items, { withCost: money }), "price-book.csv")}
          >
            <FileText strokeWidth={1.5} /> Export
          </WzToolbarButton>
          {canCreate ? (
            <WzToolbarButton title="Import CSV" disabled={permsLoading} onClick={() => setImportOpen(true)}>
              <Upload strokeWidth={1.5} /> Import
            </WzToolbarButton>
          ) : null}
        </div>
      </WzListToolbar>

      {query.isError && !query.data ? (
        <div className="border border-wz-frame px-5 py-10 text-center text-sm">
          <p role="alert">Couldn&apos;t load items</p>
          <Button variant="outline" size="sm" className="mt-3" onClick={() => query.refetch()}>
            Try again
          </Button>
        </div>
      ) : (
        <ItemsTable
          items={items}
          showCost={permsLoading || money}
          brandNames={brandNames}
          onOpen={(p: Product) => open({ kind: "edit", id: p.id })}
          loading={!ready}
          stale={query.isPlaceholderData}
          // Drawn with the rows, its total and all — never under the loader.
          footer={ready ? <WzPager pager={pager} plainNumbers /> : null}
        />
      )}

      <ImportProductsDialog open={importOpen} onOpenChange={setImportOpen} />
      {/* Mounted only while open: closing must not flash the popup into
          another mode as its state clears under it. */}
      {editId || creating ? (
        <ProductDialog
          productId={editId}
          open
          onOpenChange={(next) => (next ? undefined : close())}
          onCreated={(p) => open({ kind: "edit", id: p.id })}
        />
      ) : null}
    </div>
  );
}

function downloadCsv(csv: string, filename: string) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
