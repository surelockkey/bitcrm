"use client";

import { useMemo, useState } from "react";
import { Download, Package, PackagePlus, Search, TriangleAlert, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { InventoryStatus } from "@bitcrm/types";
import type { Product } from "@bitcrm/types";
import { usePermissions } from "@/features/auth/use-permissions";
import { ManageStockDialog } from "@/features/inventory/stock/components/manage-stock-dialog";
import { useDebouncedValue } from "@/lib/use-debounced-value";
import { useUrlPopups } from "@/features/inventory/use-url-popups";
import { useItemCategories, useProducts, useProductsCount } from "../hooks";
import { productsToCsv, type ProductFilter } from "../lib";
import { ProductsTable } from "./products-table";
import { ProductDialog } from "./product-dialog";
import { ImportProductsDialog } from "./import-products-dialog";
import { ListPagination } from "@/components/ui/list-pagination";
import { pagedSource } from "@/lib/paging/paged-source";
import { usePageSize } from "@/lib/paging/use-page-size";
import { usePager } from "@/lib/paging/use-pager";

const ITEMS_PATH = "/inventory/items";

/** The URL params that open a popup — one at a time. */
type Popup = "edit" | "stock" | "new";
const POPUPS: Popup[] = ["edit", "stock", "new"];

export function ProductsPage() {
  const { can } = usePermissions();
  const money = can("financials", "view");

  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<string>("all");
  const [status, setStatus] = useState<string>(InventoryStatus.ACTIVE);
  const [importOpen, setImportOpen] = useState(false);

  // The Items tab is the stock list: services and items that opted out of
  // stock live in the price book, not here.
  const term = useDebouncedValue(search.trim(), 300);
  const filter: ProductFilter = useMemo(
    () => ({
      manageStock: true,
      search: term || undefined,
      category: category === "all" ? undefined : category,
      status: status === "all" ? undefined : (status as InventoryStatus),
    }),
    [term, category, status],
  );

  const [pageSize, setPageSize] = usePageSize("inventory-items");
  const query = useProducts(filter, pageSize);
  const count = useProductsCount(filter);
  const pager = usePager(pagedSource(query), {
    total: count.data?.total,
    totalIsFloor: count.data?.atLeast,
    pageSize,
    resetKey: JSON.stringify({ filter, pageSize }),
  });
  const products = pager.items;

  // Every category the catalog knows (archived too — items still carry them),
  // not the handful on the page being shown.
  const catalog = useItemCategories(can("product_categories", "view"));
  const categories = useMemo(
    () => [...new Set((catalog.data ?? []).map((c) => c.name))].sort((a, b) => a.localeCompare(b)),
    [catalog.data],
  );

  // Popups live in the URL, so a link to an item (or an old /inventory/items/<id>
  // bookmark, redirected here) opens it.
  const popups = useUrlPopups(ITEMS_PATH, POPUPS);
  const editId = popups.param("edit");
  const stockId = popups.param("stock");
  const creating = !editId && popups.param("new") === "1";

  if (!can("products", "view")) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
        <h2 className="text-lg font-medium">No access</h2>
        <p className="text-sm text-muted-foreground">
          You don&apos;t have permission to view items.
        </p>
      </div>
    );
  }

  const exportCsv = () =>
    downloadCsv(productsToCsv(products, { withCost: money }), "items.csv");

  return (
    <div className="flex flex-1 flex-col">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2 px-6 py-3">
        <div className="relative w-full max-w-xs">
          <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name or SKU"
            className="h-9 pl-8"
          />
        </div>

        {categories.length > 0 ? (
          <Select value={category} onValueChange={setCategory}>
            <SelectTrigger className="h-9 w-44" aria-label="Category">
              <SelectValue placeholder="Category" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All categories</SelectItem>
              {categories.map((c) => (
                <SelectItem key={c} value={c}>
                  {c}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}

        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="h-9 w-32" aria-label="Status">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={InventoryStatus.ACTIVE}>Active</SelectItem>
            <SelectItem value={InventoryStatus.ARCHIVED}>Archived</SelectItem>
            <SelectItem value="all">All statuses</SelectItem>
          </SelectContent>
        </Select>

        {/* Скільки видно — каже панель під таблицею; тут це було б число
            однієї сторінки з виглядом підсумку. */}
        <span className="ml-auto" />

        <Button
          variant="outline"
          className="h-9 gap-1.5"
          disabled={products.length === 0}
          title="Export the items on this page"
          onClick={exportCsv}
        >
          <Download className="size-4" />
          Export CSV
        </Button>
        {can("products", "create") ? (
          <Button variant="outline" className="h-9 gap-1.5" onClick={() => setImportOpen(true)}>
            <Upload className="size-4" />
            Import CSV
          </Button>
        ) : null}
        {can("products", "create") ? (
          <Button className="h-9 gap-1.5 px-3.5" onClick={() => popups.open("new")}>
            <PackagePlus className="size-4" />
            New item
          </Button>
        ) : null}
      </div>

      {/* Body */}
      <div className="flex-1 px-6 pb-6">
        {query.isLoading ? (
          <TableSkeleton />
        ) : query.isError ? (
          <ErrorState onRetry={() => query.refetch()} />
        ) : products.length === 0 ? (
          <EmptyState
            filtered={!!filter.search || !!filter.category || status !== InventoryStatus.ACTIVE}
            canCreate={can("products", "create")}
            onCreate={() => popups.open("new")}
          />
        ) : (
          <>
            <ProductsTable
              products={products}
              showCost={money}
              onEdit={(p: Product) => popups.open("edit", p.id)}
              onStock={(p: Product) => popups.open("stock", p.id)}
            />
            <ListPagination pager={pager} size={pageSize} onSizeChange={setPageSize} />
          </>
        )}
      </div>

      <ImportProductsDialog open={importOpen} onOpenChange={setImportOpen} />
      {/* Mounted only while their param is set: a popup closing must not
          flash into another mode as the param clears under it. */}
      {editId || creating ? (
        <ProductDialog
          productId={editId}
          open
          onOpenChange={(open) => (open ? undefined : popups.close())}
          onCreated={(p) => popups.replace("edit", p.id)}
        />
      ) : null}
      {stockId ? (
        <ManageStockDialog
          productId={stockId}
          open
          onOpenChange={(open) => (open ? undefined : popups.close())}
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

function TableSkeleton() {
  return (
    <div className="space-y-2 rounded-lg border p-4">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="flex items-center gap-3">
          <Skeleton className="h-4 w-16" />
          <Skeleton className="h-4 w-48" />
          <Skeleton className="h-4 w-24" />
        </div>
      ))}
    </div>
  );
}

function EmptyState({
  filtered,
  canCreate,
  onCreate,
}: {
  filtered: boolean;
  canCreate: boolean;
  onCreate: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed py-16 text-center">
      <div className="flex size-12 items-center justify-center rounded-xl bg-muted text-muted-foreground">
        <Package className="size-6" />
      </div>
      <div>
        <div className="font-medium">{filtered ? "No items match" : "No items yet"}</div>
        <p className="mt-1 text-sm text-muted-foreground">
          {filtered ? "Try clearing your search or filters." : "Add your first item or import a CSV."}
        </p>
      </div>
      {!filtered && canCreate ? (
        <Button variant="outline" className="gap-1.5" onClick={onCreate}>
          <PackagePlus className="size-4" />
          New item
        </Button>
      ) : null}
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
