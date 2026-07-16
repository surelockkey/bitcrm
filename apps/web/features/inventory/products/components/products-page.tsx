"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Archive,
  Download,
  Loader2,
  Package,
  PackagePlus,
  Search,
  TriangleAlert,
  Upload,
} from "lucide-react";
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
import { InventoryStatus, ProductType } from "@bitcrm/types";
import { queryKeys } from "@/lib/query-keys";
import { getApiErrorMessage } from "@/lib/api/errors";
import { usePermissions } from "@/features/auth/use-permissions";
import { useProducts } from "../hooks";
import * as api from "../api";
import { collectCategories, productsToCsv, type ProductFilter } from "../lib";
import { ProductsTable } from "./products-table";
import { ImportProductsDialog } from "./import-products-dialog";

export function ProductsPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const { can } = usePermissions();

  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<string>("all");
  const [type, setType] = useState<string>("all");
  const [status, setStatus] = useState<string>(InventoryStatus.ACTIVE);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [importOpen, setImportOpen] = useState(false);
  const [bulkPending, setBulkPending] = useState(false);

  const filter: ProductFilter = useMemo(
    () => ({
      search: search || undefined,
      category: category === "all" ? undefined : category,
      type: type === "all" ? undefined : (type as ProductType),
      status: status === "all" ? undefined : (status as InventoryStatus),
    }),
    [search, category, type, status],
  );

  const query = useProducts(filter);
  const products = useMemo(
    () => query.data?.pages.flatMap((p) => p.data) ?? [],
    [query.data],
  );
  const categories = useMemo(() => collectCategories(products), [products]);

  // A category/type filter overrides search+status server-side.
  const overriding = category !== "all" || type !== "all";

  if (!can("products", "view")) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
        <h2 className="text-lg font-medium">No access</h2>
        <p className="text-sm text-muted-foreground">
          You don&apos;t have permission to view products.
        </p>
      </div>
    );
  }

  const toggle = (id: string) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const toggleAll = (checked: boolean) =>
    setSelected(checked ? new Set(products.map((p) => p.id)) : new Set());

  const selectedProducts = products.filter((p) => selected.has(p.id));

  const bulkArchive = async () => {
    setBulkPending(true);
    try {
      await Promise.all([...selected].map((id) => api.archiveProduct(id)));
      toast.success(`Archived ${selected.size} ${selected.size === 1 ? "product" : "products"}`);
      setSelected(new Set());
      qc.invalidateQueries({ queryKey: queryKeys.inventory.products.all() });
    } catch (e) {
      toast.error(getApiErrorMessage(e));
    } finally {
      setBulkPending(false);
    }
  };

  const exportSelected = () => {
    downloadCsv(productsToCsv(selectedProducts), "products.csv");
  };

  return (
    <div className="flex flex-1 flex-col">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 border-b px-6 py-4">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Products</h1>
          <p className="text-sm text-muted-foreground">
            Your catalog of parts and services — pricing, stock thresholds, and photos.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {can("products", "create") ? (
            <Button variant="outline" className="h-9 gap-1.5" onClick={() => setImportOpen(true)}>
              <Upload className="size-4" />
              Import CSV
            </Button>
          ) : null}
          {can("products", "create") ? (
            <Button
              variant="brand"
              className="h-9 gap-1.5 px-3.5"
              onClick={() => router.push("/inventory/products/new")}
            >
              <PackagePlus className="size-4" />
              New product
            </Button>
          ) : null}
        </div>
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2 px-6 py-3">
        <div className="relative w-full max-w-xs">
          <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name or SKU"
            className="h-9 pl-8"
            disabled={overriding}
          />
        </div>

        <Select
          value={category}
          onValueChange={(v) => {
            setCategory(v);
            if (v !== "all") setType("all");
          }}
        >
          <SelectTrigger className="h-9 w-44">
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

        <Select
          value={type}
          onValueChange={(v) => {
            setType(v);
            if (v !== "all") setCategory("all");
          }}
        >
          <SelectTrigger className="h-9 w-32">
            <SelectValue placeholder="Type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All types</SelectItem>
            <SelectItem value={ProductType.PRODUCT}>Product</SelectItem>
            <SelectItem value={ProductType.SERVICE}>Service</SelectItem>
          </SelectContent>
        </Select>

        <Select value={status} onValueChange={setStatus} disabled={overriding}>
          <SelectTrigger className="h-9 w-32">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value={InventoryStatus.ACTIVE}>Active</SelectItem>
            <SelectItem value={InventoryStatus.ARCHIVED}>Archived</SelectItem>
          </SelectContent>
        </Select>

        <span className="ml-auto text-sm text-muted-foreground">
          {products.length}
          {query.hasNextPage ? "+" : ""} {products.length === 1 ? "product" : "products"}
        </span>
      </div>

      {overriding ? (
        <p className="px-6 pb-1 text-xs text-muted-foreground">
          A category or type filter is active — search and status are applied only without them.
        </p>
      ) : null}

      {/* Bulk bar */}
      {selected.size > 0 ? (
        <div className="mx-6 mb-2 flex items-center gap-3 rounded-lg border bg-muted/40 px-4 py-2 text-sm">
          <span className="font-medium">{selected.size} selected</span>
          <div className="ml-auto flex items-center gap-2">
            <Button variant="outline" size="sm" className="gap-1.5" onClick={exportSelected}>
              <Download className="size-3.5" />
              Export CSV
            </Button>
            {can("products", "delete") ? (
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5 text-destructive"
                disabled={bulkPending}
                onClick={bulkArchive}
              >
                {bulkPending ? <Loader2 className="size-3.5 animate-spin" /> : <Archive className="size-3.5" />}
                Archive
              </Button>
            ) : null}
            <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>
              Clear
            </Button>
          </div>
        </div>
      ) : null}

      {/* Body */}
      <div className="flex-1 px-6 pb-6">
        {query.isLoading ? (
          <TableSkeleton />
        ) : query.isError ? (
          <ErrorState onRetry={() => query.refetch()} />
        ) : products.length === 0 ? (
          <EmptyState
            filtered={overriding || !!search || status !== InventoryStatus.ACTIVE}
            canCreate={can("products", "create")}
            onCreate={() => router.push("/inventory/products/new")}
          />
        ) : (
          <>
            <ProductsTable
              products={products}
              selected={selected}
              onToggle={toggle}
              onToggleAll={toggleAll}
            />
            {query.hasNextPage ? (
              <div className="mt-4 flex justify-center">
                <Button
                  variant="outline"
                  onClick={() => query.fetchNextPage()}
                  disabled={query.isFetchingNextPage}
                  className="gap-1.5"
                >
                  {query.isFetchingNextPage ? <Loader2 className="size-4 animate-spin" /> : null}
                  Load more
                </Button>
              </div>
            ) : null}
          </>
        )}
      </div>

      <ImportProductsDialog open={importOpen} onOpenChange={setImportOpen} />
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
          <Skeleton className="size-8 rounded-lg" />
          <Skeleton className="h-4 w-48" />
          <Skeleton className="ml-auto h-4 w-24" />
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
        <div className="font-medium">{filtered ? "No products match" : "No products yet"}</div>
        <p className="mt-1 text-sm text-muted-foreground">
          {filtered ? "Try clearing your search or filters." : "Add your first product or import a CSV."}
        </p>
      </div>
      {!filtered && canCreate ? (
        <Button variant="outline" className="gap-1.5" onClick={onCreate}>
          <PackagePlus className="size-4" />
          New product
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
      <div className="font-medium">Couldn&apos;t load products</div>
      <Button variant="outline" onClick={onRetry}>
        Retry
      </Button>
    </div>
  );
}
