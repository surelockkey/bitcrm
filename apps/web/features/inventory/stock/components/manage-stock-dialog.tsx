"use client";

import { useMemo, useState, type ReactNode } from "react";
import { Truck, Warehouse } from "lucide-react";
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
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
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
import { TableFrame } from "@/features/inventory/components/table-frame";
import {
  PanelError,
  PanelLoading,
  PanelPager,
  PanelToolbar,
  STOCK_POPUP,
  StatCard,
  tableHeight,
  usePopupPageSize,
} from "./stock-popup-parts";
import { INVENTORY_ROW } from "@/features/inventory/components/inventory-table";

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
        // popup fits a phone as well as a desktop — at one height throughout.
        className={cn(STOCK_POPUP, "sm:max-w-6xl")}
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
  // Its row in the Items list gives the title and the prices at once.
  const product = useProduct(productId, { seed: true });
  const stock = useProductStock(productId, open);

  const item = product.data;
  const title = item ? `Manage stock - ${item.name} (${item.sku})` : "Manage stock";
  const money = can("financials", "view");
  const actions = can("transfers", "create");
  const [size, setSize] = usePopupPageSize();

  let body: ReactNode;
  if (product.isError || stock.isError) {
    body = (
      <PanelError
        onRetry={() => {
          if (product.isError) product.refetch();
          if (stock.isError) stock.refetch();
        }}
      />
    );
  } else if (product.isLoading || stock.isLoading || !item || !stock.data) {
    body = (
      <PanelLoading
        testId="manage-stock-loading"
        cards={money ? 3 : 2}
        searchLabel="Search locations"
        headers={
          actions ? ["Location", "Description", "Quantity", "Actions"] : ["Location", "Description", "Quantity"]
        }
        size={size}
        onSize={setSize}
      />
    );
  } else {
    body = (
      <StockBody
        product={item}
        onHand={stock.data.onHand}
        locations={stock.data.locations}
        money={money}
        actions={actions}
        allowAdd={allowAdd}
        size={size}
        onSize={setSize}
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
  size,
  onSize,
}: {
  product: Product;
  onHand: number;
  locations: ProductLocationStock[];
  money: boolean;
  actions: boolean;
  allowAdd: boolean;
  size: number;
  onSize: (size: number) => void;
}) {
  const [search, setSearch] = useState("");
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
        <PanelToolbar
          search={search}
          onSearch={(term) => {
            setSearch(term);
            setPage(1);
          }}
          searchLabel="Search locations"
          size={size}
          onSize={(n) => {
            onSize(n);
            setPage(1);
          }}
        />

        {/* A page tall even on a short last page: the pager under it stays put. */}
        <TableFrame className="bg-background" style={{ minHeight: tableHeight(Math.min(size, matching.length)) }}>
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
        </TableFrame>

        <PanelPager view={view} onPage={setPage} />
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
  // A location deleted in Workiz is listed only while it still holds the item,
  // so its units stay counted and can still be moved or returned.
  const deleted = l.placeholder === true;
  const archived = deleted || l.status === InventoryStatus.ARCHIVED;
  const Icon = l.locationType === "warehouse" ? Warehouse : Truck;
  return (
    <TableRow className={cn(INVENTORY_ROW, deleted && "opacity-55")}>
      <TableCell className="overflow-hidden">
        <div className="flex items-center gap-2">
          <Icon aria-hidden className="size-4 flex-none text-muted-foreground" />
          <span className="truncate font-medium">{l.name}</span>
          {archived ? (
            <Badge variant="outline" className="flex-none font-normal text-muted-foreground">
              {deleted ? "Deleted in Workiz" : "Archived"}
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
            archived={archived}
          />
        </TableCell>
      ) : null}
    </TableRow>
  );
}
