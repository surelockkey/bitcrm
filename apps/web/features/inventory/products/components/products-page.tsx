"use client";

import { useCallback, useMemo, useState } from "react";
import { FileText, Plus, Upload } from "lucide-react";
import { InventoryStatus } from "@bitcrm/types";
import type { Product } from "@bitcrm/types";
import { Button } from "@/components/ui/button";
import { WzSelect } from "@/components/workiz/select";
import { WzPager } from "@/components/workiz/pager";
import { WZ_GRID_PAGE_SIZES } from "@/components/workiz/local-grid";
import { WzListToolbar, WzPageSizeSelect, WzSearchBox, WzToolbarButton } from "@/components/workiz/toolbar";
import { useDenied, usePermissions } from "@/features/auth/use-permissions";
import { NoAccess } from "@/features/inventory/components/no-access";
import { useInventoryPageReady } from "@/features/inventory/components/inventory-frame";
import { useItemAttributes } from "@/features/inventory/item-attributes/hooks";
import { ManageStockDialog } from "@/features/inventory/stock/components/manage-stock-dialog";
import { usePopup } from "@/features/inventory/use-popup";
import { brandNameMap, showGroups } from "@/features/price-book/lib";
import { useDebouncedValue } from "@/lib/use-debounced-value";
import { settled } from "@/lib/use-page-ready";
import { pagedSource } from "@/lib/paging/paged-source";
import { usePageSize } from "@/lib/paging/use-page-size";
import { usePager } from "@/lib/paging/use-pager";
import { useBrands, useItemCategories, useProducts, useProductsCount } from "../hooks";
import { productsToCsv } from "../lib";
import { ITEMS_FILTERS_DEFAULT, customFieldColumns, itemsFilter, type ItemsFilters } from "../items-view";
import { PRODUCTS_TABLE_KEY, ProductsTable } from "./products-table";
import { ProductDialog } from "./product-dialog";
import { ImportProductsDialog } from "./import-products-dialog";

/** The popup over the list — one at a time. */
type ItemsPopup = { kind: "edit"; id: string } | { kind: "stock"; id: string } | { kind: "new" };

/** Old links carried the popup in the query; they land on the plain list, the params dropped. */
const STALE_PARAMS = ["edit", "stock", "new"] as const;

/** Workiz's page size before the reader picks one. */
const DEFAULT_PAGE_SIZE = 10;

const STOCK_OPTIONS = [
  { value: "all", label: "All Stock Levels" },
  { value: "stocked", label: "Stocked" },
  { value: "low", label: "Low Stock" },
];

/** BitCRM's own box (Workiz deletes items; BitCRM disables them, so the way back stays). */
const STATUS_OPTIONS = [
  { value: InventoryStatus.ACTIVE, label: "Active items" },
  { value: InventoryStatus.ARCHIVED, label: "Disabled items" },
  { value: "all", label: "All items" },
];

/**
 * Workiz's Inventory tab (`/root/inventory`, pg_inventory_wz_01_inventory):
 * the boxes All brands / All categories / All Stock Levels (and BitCRM's
 * status box beside them) with the yellow Add New at the right; the grey
 * strip (Search; the page size, Export — and BitCRM's Import); the grid of
 * stock-managed items with the pager inside it. Every filter goes to the
 * server. The pencil (or the row) opens Workiz's "Edit Inventory item", the
 * box its "Manage stock" — popups over the list, never pages.
 *
 * It loads once: the rows wait for the permissions (the Cost column, the
 * buttons), the count (the pager's "of N"), the brands (the Brand column),
 * the custom fields (their columns) and the tab row's counters; a new filter
 * keeps the rows on screen, dimmed.
 */
export function ProductsPage() {
  const { can, isLoading: permsLoading } = usePermissions();
  const denied = useDenied();
  const money = can("financials", "view");
  // Until the permissions answer, every control is drawn (and off).
  const canCreate = permsLoading || can("products", "create");
  const canCategories = permsLoading || can("product_categories", "view");
  const canBrands = permsLoading || can("brands", "view");

  const [filters, setFilters] = useState<ItemsFilters>(ITEMS_FILTERS_DEFAULT);
  const [searchInput, setSearchInput] = useState("");
  const [importOpen, setImportOpen] = useState(false);
  const set = (patch: Partial<ItemsFilters>) => setFilters((f) => ({ ...f, ...patch }));

  const term = useDebouncedValue(searchInput.trim(), 300);
  const filter = useMemo(() => itemsFilter(filters, term), [filters, term]);

  const [pageSize, setPageSize] = usePageSize(PRODUCTS_TABLE_KEY, { sizes: WZ_GRID_PAGE_SIZES, fallback: DEFAULT_PAGE_SIZE });
  const query = useProducts(filter, pageSize);
  const count = useProductsCount(filter);
  // While the previous filter's rows stand in for the new ones their cursor
  // belongs to the old set — no paging through them.
  const src = pagedSource(query);
  const pager = usePager(query.isPlaceholderData ? { ...src, hasNextPage: false } : src, {
    total: count.data?.total,
    totalIsFloor: count.data?.atLeast,
    pageSize,
    resetKey: JSON.stringify({ filter, pageSize }),
  });
  const products = pager.items;

  // The catalogs, asked for beside the permissions, not after them — the
  // server guards them. Every category and brand (archived too: items carry them).
  const categoryCatalog = useItemCategories(canCategories);
  const brandCatalog = useBrands(canBrands);
  const attributes = useItemAttributes();

  const ready = useInventoryPageReady(
    !permsLoading &&
      settled(query) &&
      settled(count) &&
      (!canBrands || settled(brandCatalog)) &&
      settled(attributes),
  );

  // The boxes' lists, in Workiz's order (its ids), from the Price Book's own menu.
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
  const optionsOf = (key: "brand" | "category", all: string) => [
    { value: "all", label: all },
    ...(groups.find((g) => g.key === key)?.options ?? []).map((o) => ({ value: o.value, label: o.label })),
  ];
  const brandNames = useMemo(() => brandNameMap(brandCatalog.data), [brandCatalog.data]);
  const customFields = useMemo(() => customFieldColumns(attributes.data), [attributes.data]);

  // Popups are state: a row opens one and the address stays. No address opens
  // one — an old ?edit= link lands on the plain list.
  const { popup, open, close } = usePopup<ItemsPopup>(STALE_PARAMS);
  const editId = popup?.kind === "edit" ? popup.id : null;
  const stockId = popup?.kind === "stock" ? popup.id : null;
  const creating = popup?.kind === "new";
  const onEdit = useCallback((p: Product) => open({ kind: "edit", id: p.id }), [open]);
  const onStock = useCallback((p: Product) => open({ kind: "stock", id: p.id }), [open]);

  // Refused only once the permissions are known — never a flash of "No access".
  if (denied("products", "view")) {
    return <NoAccess text="You don't have permission to view items." />;
  }
  const failed = query.isError && !query.data;

  return (
    // The frame drawn while the permissions load is a guess at what they
    // allow; once they answer it is drawn anew, not reshuffled — a role the
    // guess was wrong for (no Add New, no Cost) sees no control slide across.
    <div key={permsLoading ? "guess" : "known"} className="flex flex-col">
      {/* The boxes 20px under the tab rule, 10px apart (200×48.64 each), Add
          New level with them 20px from the right; 20px down to the strip. */}
      <div data-testid="items-filters" className="flex shrink-0 items-center gap-2.5 p-5">
        {canBrands ? (
          <WzSelect
            label="Brand"
            geometry="bare"
            className="w-[200px] flex-none"
            options={optionsOf("brand", "All brands")}
            value={filters.brand}
            onChange={(v) => set({ brand: v || "all" })}
            disabled={permsLoading}
          />
        ) : null}
        {canCategories ? (
          <WzSelect
            label="Category"
            geometry="bare"
            className="w-[200px] flex-none"
            options={optionsOf("category", "All categories")}
            value={filters.category}
            onChange={(v) => set({ category: v || "all" })}
            disabled={permsLoading}
          />
        ) : null}
        <WzSelect
          label="Stock level"
          geometry="bare"
          searchable={false}
          className="w-[200px] flex-none"
          options={STOCK_OPTIONS}
          value={filters.stock}
          onChange={(v) => set({ stock: (v || "all") as ItemsFilters["stock"] })}
        />
        <WzSelect
          label="Status"
          geometry="bare"
          searchable={false}
          className="w-[200px] flex-none"
          options={STATUS_OPTIONS}
          value={filters.status}
          onChange={(v) => set({ status: (v || InventoryStatus.ACTIVE) as ItemsFilters["status"] })}
        />
        {canCreate ? (
          <Button className="ml-auto" disabled={permsLoading} onClick={() => open({ kind: "new" })}>
            <Plus />
            Add New
          </Button>
        ) : null}
      </div>

      {/* The grey strip: Search; the page size, Export and ours, Import, at the right. */}
      <WzListToolbar data-testid="items-toolbar" className="shrink-0">
        <WzSearchBox value={searchInput} onChange={setSearchInput} maxLength={100} />
        <div className="ml-auto flex items-center gap-4">
          <WzPageSizeSelect value={pageSize} sizes={WZ_GRID_PAGE_SIZES} onChange={setPageSize} />
          <WzToolbarButton
            title="Export CSV"
            disabled={!ready || products.length === 0}
            onClick={() => downloadCsv(productsToCsv(products, { withCost: money }), "inventory.csv")}
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

      {failed ? (
        <div className="border border-wz-frame px-5 py-10 text-center text-sm">
          <p role="alert">Couldn&apos;t load items</p>
          <Button variant="outline" size="sm" className="mt-3" onClick={() => query.refetch()}>
            Try again
          </Button>
        </div>
      ) : (
        <ProductsTable
          products={products}
          showCost={permsLoading ? "pending" : money}
          brandNames={brandNames}
          customFields={customFields}
          onEdit={onEdit}
          onStock={onStock}
          loading={!ready}
          stale={query.isPlaceholderData}
          // Drawn with the rows, its total and all — never under the loader.
          footer={ready ? <WzPager pager={pager} plainNumbers /> : null}
        />
      )}

      <ImportProductsDialog open={importOpen} onOpenChange={setImportOpen} />
      {/* Mounted only while open: a popup closing must not flash into
          another mode as its state clears under it. */}
      {editId || creating ? (
        <ProductDialog
          productId={editId}
          open
          onOpenChange={(next) => (next ? undefined : close())}
          onCreated={(p) => open({ kind: "edit", id: p.id })}
        />
      ) : null}
      {stockId ? (
        <ManageStockDialog productId={stockId} open onOpenChange={(next) => (next ? undefined : close())} />
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
