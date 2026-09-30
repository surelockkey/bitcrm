"use client";

import { useMemo, useState } from "react";
import { Download, PackagePlus, Search, TriangleAlert, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ListPagination } from "@/components/ui/list-pagination";
import { InventoryStatus, ProductType } from "@bitcrm/types";
import type { Product } from "@bitcrm/types";
import { useDenied, usePermissions } from "@/features/auth/use-permissions";
import { useUrlPopups } from "@/features/inventory/use-url-popups";
import { useBrands, useItemCategories } from "@/features/inventory/products/hooks";
import { productsToCsv } from "@/features/inventory/products/lib";
import { ProductDialog } from "@/features/inventory/products/components/product-dialog";
import { ImportProductsDialog } from "@/features/inventory/products/components/import-products-dialog";
import { useDebouncedValue } from "@/lib/use-debounced-value";
import { cn } from "@/lib/utils";
import { pagedSource } from "@/lib/paging/paged-source";
import { usePageSize } from "@/lib/paging/use-page-size";
import { usePager } from "@/lib/paging/use-pager";
import { usePriceBookCount, usePriceBookItems } from "../hooks";
import {
  DEFAULT_FILTERS,
  brandNameMap,
  isFiltered,
  toProductFilter,
  type PriceBookFilters,
  type StockChoice,
} from "../lib";
import { useSkeletonRows } from "../use-skeleton-rows";
import { ITEMS_TABLE_KEY, ItemsTable } from "./items-table";

const ITEMS_PATH = "/price-book/items";

/** The URL params that open a popup — one at a time. */
type Popup = "edit" | "new";
const POPUPS: Popup[] = ["edit", "new"];

const byName = (a: string, b: string) => a.localeCompare(b);

/**
 * The Price Book's Items tab — every item, product or service, stock-managed
 * or not. Every filter goes to the server; a page is never filtered here.
 * Items open in the same Edit / Create popup Inventory uses.
 */
export function ItemsPage() {
  const { can } = usePermissions();
  const denied = useDenied();
  const money = can("financials", "view");
  const canCreate = can("products", "create");

  const [filters, setFilters] = useState<PriceBookFilters>(DEFAULT_FILTERS);
  const [importOpen, setImportOpen] = useState(false);
  const set = <K extends keyof PriceBookFilters>(key: K) => (value: PriceBookFilters[K]) =>
    setFilters((f) => ({ ...f, [key]: value }));

  const term = useDebouncedValue(filters.search.trim(), 300);
  const filter = useMemo(() => toProductFilter({ ...filters, search: term }), [filters, term]);

  const [pageSize, setPageSize] = usePageSize(ITEMS_TABLE_KEY);
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
  const skeletonRows = useSkeletonRows(
    ITEMS_TABLE_KEY,
    pageSize,
    count.data?.total,
    query.isLoading || query.isPlaceholderData ? undefined : items.length,
  );

  // Every category and brand the catalogs know (archived too — items still
  // carry them), not the handful on the page being shown.
  const categoryCatalog = useItemCategories(can("product_categories", "view"));
  const brandCatalog = useBrands(can("brands", "view"));
  const categories = useMemo(
    () => [...new Set((categoryCatalog.data ?? []).map((c) => c.name))].sort(byName),
    [categoryCatalog.data],
  );
  const brands = useMemo(
    () => [...(brandCatalog.data ?? [])].sort((a, b) => byName(a.name, b.name)),
    [brandCatalog.data],
  );
  const brandNames = useMemo(() => brandNameMap(brandCatalog.data), [brandCatalog.data]);

  const popups = useUrlPopups(ITEMS_PATH, POPUPS);
  const editId = popups.param("edit");
  const creating = !editId && popups.param("new") === "1";

  if (denied("products")) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
        <h2 className="text-lg font-medium">No access</h2>
        <p className="text-sm text-muted-foreground">You don&apos;t have permission to view items.</p>
      </div>
    );
  }

  const filtered = isFiltered(filters);

  return (
    <div className="flex flex-1 flex-col">
      <div data-testid="price-book-toolbar" className="flex flex-wrap items-center gap-2 px-6 py-3">
        <div className="relative w-full max-w-xs">
          <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={filters.search}
            onChange={(e) => set("search")(e.target.value)}
            placeholder="Search name or SKU"
            aria-label="Search items"
            className="h-9 pl-8"
          />
        </div>

        <FilterSelect label="Type" value={filters.type} onChange={set("type")} width="w-32">
          <SelectItem value="all">All types</SelectItem>
          <SelectItem value={ProductType.PRODUCT}>Product</SelectItem>
          <SelectItem value={ProductType.SERVICE}>Service</SelectItem>
        </FilterSelect>

        {can("product_categories", "view") ? (
          <FilterSelect label="Category" value={filters.category} onChange={set("category")} width="w-44">
            <SelectItem value="all">All categories</SelectItem>
            {categories.map((c) => (
              <SelectItem key={c} value={c}>
                {c}
              </SelectItem>
            ))}
          </FilterSelect>
        ) : null}

        {can("brands", "view") ? (
          <FilterSelect label="Brand" value={filters.brandId} onChange={set("brandId")} width="w-40">
            <SelectItem value="all">All brands</SelectItem>
            {brands.map((b) => (
              <SelectItem key={b.id} value={b.id}>
                {b.name}
              </SelectItem>
            ))}
          </FilterSelect>
        ) : null}

        <FilterSelect label="Status" value={filters.status} onChange={set("status")} width="w-32">
          <SelectItem value={InventoryStatus.ACTIVE}>Active</SelectItem>
          <SelectItem value={InventoryStatus.ARCHIVED}>Archived</SelectItem>
          <SelectItem value="all">All statuses</SelectItem>
        </FilterSelect>

        <FilterSelect<StockChoice>
          label="Manage stock"
          value={filters.manageStock}
          onChange={set("manageStock")}
          width="w-36"
        >
          <SelectItem value="all">All items</SelectItem>
          <SelectItem value="tracked">Tracked</SelectItem>
          <SelectItem value="untracked">Not tracked</SelectItem>
        </FilterSelect>

        <span className="ml-auto" />

        <Button
          variant="outline"
          className="h-9 gap-1.5"
          disabled={items.length === 0}
          title="Export the items on this page"
          onClick={() => downloadCsv(productsToCsv(items, { withCost: money }), "price-book.csv")}
        >
          <Download className="size-4" />
          Export CSV
        </Button>
        {canCreate ? (
          <Button variant="outline" className="h-9 gap-1.5" onClick={() => setImportOpen(true)}>
            <Upload className="size-4" />
            Import CSV
          </Button>
        ) : null}
        {canCreate ? (
          <Button className="h-9 gap-1.5 px-3.5" onClick={() => popups.open("new")}>
            <PackagePlus className="size-4" />
            New item
          </Button>
        ) : null}
      </div>

      <div className="flex-1 px-6 pb-6">
        {query.isError && !query.data ? (
          <ErrorState onRetry={() => query.refetch()} />
        ) : (
          <>
            <ItemsTable
              items={items}
              showCost={money}
              brandNames={brandNames}
              onEdit={(p: Product) => popups.open("edit", p.id)}
              loading={query.isLoading}
              skeletonRows={skeletonRows}
              stale={query.isPlaceholderData}
              empty={<EmptyState filtered={filtered} />}
            />
            {/* The bar's room is kept while the first page loads, so nothing
                under the table moves when the rows land. */}
            <div data-testid="pager-slot" className="min-h-14">
              {query.isLoading ? null : (
                <ListPagination pager={pager} size={pageSize} onSizeChange={setPageSize} />
              )}
            </div>
          </>
        )}
      </div>

      <ImportProductsDialog open={importOpen} onOpenChange={setImportOpen} />
      {/* Mounted only while its param is set: closing must not flash the
          popup into another mode as the param clears under it. */}
      {editId || creating ? (
        <ProductDialog
          productId={editId}
          open
          onOpenChange={(open) => (open ? undefined : popups.close())}
          onCreated={(p) => popups.replace("edit", p.id)}
        />
      ) : null}
    </div>
  );
}

function FilterSelect<V extends string>({
  label,
  value,
  onChange,
  width,
  children,
}: {
  label: string;
  value: V;
  onChange: (value: V) => void;
  width: string;
  children: React.ReactNode;
}) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as V)}>
      <SelectTrigger className={cn("h-9", width)} aria-label={label}>
        <SelectValue placeholder={label} />
      </SelectTrigger>
      <SelectContent>{children}</SelectContent>
    </Select>
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

function EmptyState({ filtered }: { filtered: boolean }) {
  return (
    <div>
      <div className="font-medium">{filtered ? "No items match" : "No items yet"}</div>
      <p className="mt-1 text-sm text-muted-foreground">
        {filtered
          ? "Try clearing your search or filters."
          : "Add your first item with New item, or import a CSV."}
      </p>
    </div>
  );
}

function ErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed py-16 text-center">
      <div className="flex size-12 items-center justify-center rounded-xl bg-destructive/10 text-destructive">
        <TriangleAlert className="size-6" />
      </div>
      <div className="font-medium">Couldn&apos;t load items</div>
      <Button variant="outline" onClick={onRetry}>
        Retry
      </Button>
    </div>
  );
}
