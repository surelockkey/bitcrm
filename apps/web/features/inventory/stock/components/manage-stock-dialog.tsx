"use client";

import { useMemo, useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight, Search, Truck, TriangleAlert, Warehouse } from "lucide-react";
import { InventoryStatus } from "@bitcrm/types";
import type { Product, ProductLocationStock } from "@bitcrm/types";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { usePermissions } from "@/features/auth/use-permissions";
import { useProduct, useProductStock } from "@/features/inventory/products/hooks";
import { filterStockRows, pageSlice, stockSummary } from "../lib";
import { StockRowActions } from "./stock-row-actions";

const PAGE_SIZES = [10, 25, 50] as const;

/**
 * Workiz's "Manage stock" popup for one item: what it holds in total, what
 * that cost and sells for, and every location with add / move / return.
 *
 * The endpoint returns every location at once, so search and paging happen
 * here. `allowAdd={false}` drops the ＋ — stock arrives only from Items.
 */
export function ManageStockDialog({
  productId,
  open,
  onOpenChange,
  allowAdd = true,
}: {
  productId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  allowAdd?: boolean;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        // Header and footer stay put; the body scrolls between them, so the
        // popup fits a phone as well as a desktop.
        className="flex max-h-[calc(100dvh-2rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-6xl"
      >
        <ManageStock
          productId={productId}
          open={open}
          allowAdd={allowAdd}
          onDone={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  );
}

function ManageStock({
  productId,
  open,
  allowAdd,
  onDone,
}: {
  productId: string;
  open: boolean;
  allowAdd: boolean;
  onDone: () => void;
}) {
  const { can } = usePermissions();
  const product = useProduct(productId);
  const stock = useProductStock(productId, open);

  const item = product.data;
  const title = item ? `Manage stock - ${item.name} (${item.sku})` : "Manage stock";

  let body: ReactNode;
  if (product.isError || stock.isError) {
    body = (
      <ErrorState
        onRetry={() => {
          if (product.isError) product.refetch();
          if (stock.isError) stock.refetch();
        }}
      />
    );
  } else if (product.isLoading || stock.isLoading || !item || !stock.data) {
    body = <LoadingState money={can("financials", "view")} />;
  } else {
    body = (
      <StockBody
        product={item}
        onHand={stock.data.onHand}
        locations={stock.data.locations}
        money={can("financials", "view")}
        actions={can("transfers", "create")}
        allowAdd={allowAdd}
      />
    );
  }

  return (
    <>
      {/* Right padding keeps the title clear of the close button. */}
      <DialogHeader className="border-b px-4 py-3 pr-12">
        <DialogTitle className="text-base">{title}</DialogTitle>
        <DialogDescription className="sr-only">
          This item&apos;s stock in every warehouse and van.
        </DialogDescription>
      </DialogHeader>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">{body}</div>
      <DialogFooter className="m-0 flex-none">
        <Button className="px-5" onClick={onDone}>
          Done
        </Button>
      </DialogFooter>
    </>
  );
}

function StockBody({
  product,
  onHand,
  locations,
  money,
  actions,
  allowAdd,
}: {
  product: Product;
  onHand: number;
  locations: ProductLocationStock[];
  money: boolean;
  actions: boolean;
  allowAdd: boolean;
}) {
  const [search, setSearch] = useState("");
  const [size, setSize] = useState<number>(PAGE_SIZES[0]);
  const [page, setPage] = useState(1);

  const summary = stockSummary(onHand, product);
  const matching = useMemo(() => filterStockRows(locations, search), [locations, search]);
  const view = pageSlice(matching, page, size);
  const columns = actions ? 4 : 3;

  return (
    <>
      <div className={money ? "grid gap-3 sm:grid-cols-3" : "grid gap-3 sm:grid-cols-2"}>
        <StatCard label="Total on hand" value={summary.onHand} />
        {money ? <StatCard label="Total cost" value={summary.cost} /> : null}
        <StatCard label="Sale value" value={summary.sale} />
      </div>

      <div className="space-y-3 rounded-lg bg-muted/60 p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="relative w-full sm:max-w-xs">
            <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="search"
              aria-label="Search locations"
              placeholder="Search"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              className="h-9 bg-background pl-8"
            />
          </div>
          <Select
            value={String(size)}
            onValueChange={(v) => {
              setSize(Number(v));
              setPage(1);
            }}
          >
            <SelectTrigger className="h-9 w-20 bg-background" aria-label="Rows per page">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PAGE_SIZES.map((n) => (
                <SelectItem key={n} value={String(n)}>
                  {n}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="overflow-hidden border bg-background">
          {/* Fixed layout: a long van name clips instead of pushing the
              columns about; on a phone the table scrolls sideways. */}
          <Table className="min-w-[36rem] table-fixed">
            <colgroup>
              <col className="w-[34%]" />
              <col />
              <col className="w-28" />
              {actions ? <col className="w-32" /> : null}
            </colgroup>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Location</TableHead>
                <TableHead>Description</TableHead>
                <TableHead>Quantity</TableHead>
                {actions ? <TableHead>Actions</TableHead> : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {view.rows.length === 0 ? (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={columns} className="py-6 whitespace-normal text-muted-foreground">
                    {locations.length === 0
                      ? "No warehouses or containers yet."
                      : `No locations match “${search.trim()}”.`}
                  </TableCell>
                </TableRow>
              ) : (
                view.rows.map((l) => (
                  <LocationRow
                    key={`${l.locationType}:${l.locationId}`}
                    location={l}
                    product={product}
                    actions={actions}
                    allowAdd={allowAdd}
                  />
                ))
              )}
            </TableBody>
          </Table>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
          <span>
            Showing {view.from} to {view.to} of {view.total} results
          </span>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Previous page"
              disabled={view.page <= 1}
              onClick={() => setPage(view.page - 1)}
            >
              <ChevronLeft />
            </Button>
            <span className="px-1 whitespace-nowrap">
              Page {view.page} of {view.pages}
            </span>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Next page"
              disabled={view.page >= view.pages}
              onClick={() => setPage(view.page + 1)}
            >
              <ChevronRight />
            </Button>
          </div>
        </div>
      </div>
    </>
  );
}

/* Every cell clips: under fixed layout one that doesn't spills into the next. */
function LocationRow({
  location: l,
  product,
  actions,
  allowAdd,
}: {
  location: ProductLocationStock;
  product: Product;
  actions: boolean;
  allowAdd: boolean;
}) {
  const archived = l.status === InventoryStatus.ARCHIVED;
  const Icon = l.locationType === "warehouse" ? Warehouse : Truck;
  return (
    <TableRow>
      <TableCell className="overflow-hidden">
        <div className="flex items-center gap-2">
          <Icon aria-hidden className="size-4 flex-none text-muted-foreground" />
          <span className="truncate font-medium">{l.name}</span>
          {archived ? (
            <Badge variant="outline" className="flex-none font-normal text-muted-foreground">
              Archived
            </Badge>
          ) : null}
        </div>
      </TableCell>
      <TableCell className="truncate text-muted-foreground" title={l.description || undefined}>
        {l.description || "—"}
      </TableCell>
      <TableCell className="truncate tabular-nums">{Math.round(l.quantity)}</TableCell>
      {actions ? (
        <TableCell className="overflow-hidden">
          <StockRowActions
            target={{
              product: { id: product.id, name: product.name },
              location: { type: l.locationType, id: l.locationId, name: l.name },
              available: l.quantity,
            }}
            allowAdd={allowAdd}
          />
        </TableCell>
      ) : null}
    </TableRow>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div role="group" aria-label={label} className="rounded-lg border bg-card px-4 py-3">
      <div className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
        {label}
      </div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
    </div>
  );
}

function LoadingState({ money }: { money: boolean }) {
  return (
    <div data-testid="manage-stock-loading" className="space-y-4">
      <div className={money ? "grid gap-3 sm:grid-cols-3" : "grid gap-3 sm:grid-cols-2"}>
        {Array.from({ length: money ? 3 : 2 }).map((_, i) => (
          <Skeleton key={i} className="h-[4.5rem] w-full" />
        ))}
      </div>
      <div className="space-y-2 rounded-lg bg-muted/60 p-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-8 w-full" />
        ))}
      </div>
    </div>
  );
}

function ErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed py-16 text-center">
      <div className="flex size-12 items-center justify-center rounded-xl bg-destructive/10 text-destructive">
        <TriangleAlert className="size-6" />
      </div>
      <div className="font-medium">Couldn&apos;t load stock</div>
      <Button variant="outline" onClick={onRetry}>
        Retry
      </Button>
    </div>
  );
}
