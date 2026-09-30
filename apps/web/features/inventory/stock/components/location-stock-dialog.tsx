"use client";

import { useMemo, useState, type ReactNode } from "react";
import type { LocationSummaryType } from "@bitcrm/types";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { usePermissions } from "@/features/auth/use-permissions";
import type { EnrichedStockRow, StockSummary } from "@/features/inventory/warehouses/lib";
import { ApiError } from "@/lib/api/errors";
import { useLocationStock } from "../hooks";
import { filterItemRows, locationCards, pageSlice } from "../lib";
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
import { cn } from "@/lib/utils";

/**
 * One warehouse's or van's stock — the location-side twin of the item's
 * Manage stock popup: rows are items here, and there is no ＋, because stock
 * arrives only from the Items tab. Move and Return leave from this location.
 *
 * Mount it only while open (the tab pages do): the stock is read on mount.
 */
export function LocationStockDialog({
  type,
  locationId,
  open,
  onOpenChange,
  aside,
}: {
  type: LocationSummaryType;
  locationId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Shown above the stock — the Containers tab puts the van's template strip here. */
  aside?: ReactNode;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        // Header and footer stay put; the body scrolls between them, so the
        // popup fits a phone as well as a desktop — at one height throughout.
        className={cn(STOCK_POPUP, "sm:max-w-4xl")}
      >
        <LocationStock
          type={type}
          id={locationId}
          open={open}
          aside={aside}
          onDone={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  );
}

function LocationStock({
  type,
  id,
  open,
  aside,
  onDone,
}: {
  type: LocationSummaryType;
  id: string;
  open: boolean;
  aside?: ReactNode;
  onDone: () => void;
}) {
  const { can } = usePermissions();
  // One request: the location's name and its rows, named and priced.
  const stock = useLocationStock(type, id, open);
  const { name } = stock;
  // A stale `?stock=<id>`: the location itself is gone.
  const missing = stock.error instanceof ApiError && stock.error.status === 404;
  const kind = type === "container" ? "Container" : "Warehouse";
  const actions = can("transfers", "create");
  const [size, setSize] = usePopupPageSize();

  let body: ReactNode;
  if (missing) {
    body = <p className="py-10 text-center text-sm text-muted-foreground">It may have been deleted.</p>;
  } else if (stock.isError) {
    body = <PanelError onRetry={() => stock.refetch()} />;
  } else if (stock.isLoading) {
    body = (
      <PanelLoading
        testId="location-stock-loading"
        cards={3}
        searchLabel="Search items"
        headers={actions ? ["Item", "SKU", "Quantity", "Actions"] : ["Item", "SKU", "Quantity"]}
        size={size}
        onSize={setSize}
      />
    );
  } else {
    body = (
      <StockBody
        location={{ type, id, name: name ?? "" }}
        rows={stock.rows}
        summary={stock.summary}
        // The server prices every row whose item still exists; with none
        // priced there is no value to show — "—", not a $0.00.
        priced={stock.rows.length === 0 || stock.rows.some((r) => r.unitPrice != null)}
        actions={actions}
        size={size}
        onSize={setSize}
      />
    );
  }

  return (
    <>
      {/* Right padding keeps the title clear of the close button. */}
      <DialogHeader className="border-b px-4 py-3 pr-12">
        <DialogTitle className="text-base">
          {missing ? `${kind} not found` : name ? `${name} — stock` : "Stock"}
        </DialogTitle>
        <DialogDescription className="sr-only">
          Every item this {type === "container" ? "van" : "warehouse"} holds.
        </DialogDescription>
      </DialogHeader>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
        {missing ? null : aside}
        {body}
      </div>
      <DialogFooter className="m-0 flex-none">
        <Button className="px-5" onClick={onDone}>
          Done
        </Button>
      </DialogFooter>
    </>
  );
}

function StockBody({
  location,
  rows,
  summary,
  priced,
  actions,
  size,
  onSize,
}: {
  location: { type: LocationSummaryType; id: string; name: string };
  rows: EnrichedStockRow[];
  summary: StockSummary;
  priced: boolean;
  actions: boolean;
  size: number;
  onSize: (size: number) => void;
}) {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);

  const cards = locationCards(summary, priced);
  // Already in name order — the server sorts.
  const matching = useMemo(() => filterItemRows(rows, search), [rows, search]);
  const view = pageSlice(matching, page, size);
  const columns = actions ? 4 : 3;

  return (
    <>
      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard label="SKUs" value={cards.skus} />
        <StatCard label="Units" value={cards.units} />
        <StatCard label="Value" value={cards.value} />
      </div>

      <div className="space-y-3 rounded-lg bg-muted/60 p-3">
        <PanelToolbar
          search={search}
          onSearch={(term) => {
            setSearch(term);
            setPage(1);
          }}
          searchLabel="Search items"
          size={size}
          onSize={(n) => {
            onSize(n);
            setPage(1);
          }}
        />

        {/* A page tall even on a short last page: the pager under it stays put. */}
        <TableFrame className="bg-background" style={{ minHeight: tableHeight(Math.min(size, matching.length)) }}>
          {/* Fixed layout: a long item name clips instead of pushing the
              columns about; on a phone the table scrolls sideways. */}
          <Table className="min-w-[32rem] table-fixed">
            <colgroup>
              <col />
              <col className="w-40" />
              <col className="w-28" />
              {actions ? <col className="w-28" /> : null}
            </colgroup>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Item</TableHead>
                <TableHead>SKU</TableHead>
                <TableHead>Quantity</TableHead>
                {actions ? <TableHead>Actions</TableHead> : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {view.rows.length === 0 ? (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={columns} className="py-6 whitespace-normal text-muted-foreground">
                    {rows.length === 0 ? "Nothing in stock here." : `No items match “${search.trim()}”.`}
                  </TableCell>
                </TableRow>
              ) : (
                view.rows.map((r) => (
                  <ItemRow key={r.productId} row={r} location={location} actions={actions} />
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
function ItemRow({
  row: r,
  location,
  actions,
}: {
  row: EnrichedStockRow;
  location: { type: LocationSummaryType; id: string; name: string };
  actions: boolean;
}) {
  return (
    <TableRow className={INVENTORY_ROW}>
      <TableCell className="truncate font-medium" title={r.name}>
        {r.name}
      </TableCell>
      <TableCell className="truncate font-mono text-xs">{r.sku || "—"}</TableCell>
      <TableCell className="overflow-hidden">
        <div className="flex items-center gap-2">
          <span className="tabular-nums">{Math.round(r.quantity)}</span>
          {r.isLow ? (
            <Badge
              variant="outline"
              className="flex-none border-amber-500/30 font-normal text-amber-600 dark:text-amber-500"
            >
              Low
            </Badge>
          ) : null}
        </div>
      </TableCell>
      {actions ? (
        <TableCell className="overflow-hidden">
          {/* Only Move and Return: stock arrives from the Items tab. */}
          <StockRowActions
            target={{ product: { id: r.productId, name: r.name }, location, available: r.quantity }}
            allowAdd={false}
          />
        </TableCell>
      ) : null}
    </TableRow>
  );
}
