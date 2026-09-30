"use client";

import { PackageX } from "lucide-react";
import { TableCell, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ListPagination } from "@/components/ui/list-pagination";
import { arraySource } from "@/lib/paging/array-source";
import { usePageSize } from "@/lib/paging/use-page-size";
import { usePager } from "@/lib/paging/use-pager";
import { formatMoney } from "@/features/inventory/warehouses/lib";
import { InventoryTable, type InventoryColumn } from "@/features/inventory/components/inventory-table";
import { useSkeletonRows } from "@/features/inventory/components/use-skeleton-rows";
import { useContainerStockView } from "../hooks";

/**
 * The columns, with the width each one starts at — read by both the
 * `<colgroup>` and the headers, so there is one number to change. All
 * left-aligned, money and counts included, as the rest of Inventory.
 */
const COLUMNS: InventoryColumn[] = [
  { id: "product", label: "Product", width: 280 },
  { id: "category", label: "Category", width: 180 },
  { id: "onHand", label: "On hand", width: 120 },
  { id: "unit", label: "Unit", width: 120 },
  { id: "value", label: "Value", width: 130 },
];

/** Its own key: a van's shelf is not the warehouse's, and not the items list. */
const TABLE_KEY = "inventory-container-stock";

/** Two lines in the Product cell (name, SKU): taller than an inventory row — its skeleton too. */
const SHELF_ROW = "h-[3.25rem]";

/**
 * What is on one van, read-only — the technician's own "My Container" view.
 * The office moves a van's stock from its popup on the Containers tab.
 *
 * The endpoint answers the whole shelf at once; it pages here, under the same
 * panel as every list, and its first frame is the table itself.
 */
export function ContainerStockTab({ containerId }: { containerId: string }) {
  const { rows, summary, isLoading, isError } = useContainerStockView(containerId);
  const [pageSize, setPageSize] = usePageSize(TABLE_KEY);
  const pager = usePager(arraySource(rows, pageSize), {
    total: rows.length,
    pageSize,
    resetKey: String(pageSize),
  });
  // What the next visit's skeleton starts from.
  useSkeletonRows(TABLE_KEY, pageSize, undefined, isLoading ? undefined : pager.items.length);

  if (isError) return <Empty title="Couldn't load stock" body="Try again shortly." />;
  if (isLoading) return <ContainerStockSkeleton />;
  if (!isLoading && rows.length === 0) {
    return <Empty title="Empty van" body="No stock on this truck. Restock it with a transfer from a warehouse." />;
  }

  // Low is measured against the item's minimum; with none on any row there is
  // nothing to count, and "0" would be a claim nobody checked. The endpoint
  // sends no minimums, so loading draws the three cards the shelf will have.
  const levels = rows.some((r) => r.minLevel != null);

  return (
    <div className="space-y-5">
      <div className={levels ? "grid gap-3 sm:grid-cols-4" : "grid gap-3 sm:grid-cols-3"}>
        <Stat label="SKUs" value={summary.skuCount.toLocaleString()} />
        <Stat label="On hand" value={summary.totalUnits.toLocaleString()} />
        <Stat label="Value" value={formatMoney(summary.totalValue)} accent />
        {levels ? (
          <Stat label="Low stock" value={String(summary.lowCount)} warn={summary.lowCount > 0} />
        ) : null}
      </div>

      <div>
        <InventoryTable
          tableKey={TABLE_KEY}
          columns={COLUMNS}
          rowClassName={SHELF_ROW}
          footer={
            <TableRow className="hover:bg-transparent">
              <TableCell className="truncate">{summary.skuCount} SKUs</TableCell>
              <TableCell />
              <TableCell className="truncate tabular-nums">{summary.totalUnits.toLocaleString()}</TableCell>
              <TableCell />
              <TableCell className="truncate tabular-nums">{formatMoney(summary.totalValue)}</TableCell>
            </TableRow>
          }
        >
          {pager.items.map((r) => (
            <TableRow key={r.productId} className={`${SHELF_ROW} hover:bg-muted/40`}>
              {/* Every cell clips: under fixed layout one that doesn't
                  spills over the next column instead of widening its own. */}
              <TableCell className="overflow-hidden">
                <div className="truncate font-medium">{r.name}</div>
                {r.sku ? <div className="truncate font-mono text-[11px] text-muted-foreground">{r.sku}</div> : null}
              </TableCell>
              <TableCell className="truncate text-sm text-muted-foreground">{r.category ?? "—"}</TableCell>
              <TableCell className="overflow-hidden">
                {r.isLow ? (
                  <Badge variant="outline" className="gap-1 border-amber-500/30 font-normal tabular-nums text-amber-600 dark:text-amber-500">
                    {r.quantity} · low
                  </Badge>
                ) : (
                  <span className="tabular-nums">{r.quantity}</span>
                )}
              </TableCell>
              <TableCell className="truncate tabular-nums text-muted-foreground">
                {r.unitPrice != null ? formatMoney(r.unitPrice) : "—"}
              </TableCell>
              <TableCell className="truncate font-medium tabular-nums">
                {r.value != null ? formatMoney(r.value) : "—"}
              </TableCell>
            </TableRow>
          ))}
        </InventoryTable>
        <ListPagination pager={pager} size={pageSize} onSizeChange={setPageSize} reserveSpace />
      </div>
    </div>
  );
}

/**
 * The shelf before its stock is in: the three cards it will have (the
 * endpoint sends no minimums), the table over a page of placeholder rows and
 * the pager's place. "My Container" draws it too while it finds the van.
 */
export function ContainerStockSkeleton() {
  const [pageSize, setPageSize] = usePageSize(TABLE_KEY);
  const skeletonRows = useSkeletonRows(TABLE_KEY, pageSize, undefined, undefined);
  const pager = usePager(arraySource<never>([], pageSize, true), {});
  return (
    <div className="space-y-5" aria-busy="true">
      <div className="grid gap-3 sm:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} data-testid="stat-skeleton" className="h-[4.25rem]" />
        ))}
      </div>
      <div>
        <InventoryTable
          tableKey={TABLE_KEY}
          columns={COLUMNS}
          loading
          skeletonRows={skeletonRows}
          rowClassName={SHELF_ROW}
        />
        <ListPagination pager={pager} size={pageSize} onSizeChange={setPageSize} reserveSpace />
      </div>
    </div>
  );
}

function Stat({ label, value, accent, warn }: { label: string; value: string; accent?: boolean; warn?: boolean }) {
  return (
    <div className="rounded-lg border bg-card p-3.5">
      <div className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">{label}</div>
      <div className={"mt-0.5 text-xl font-semibold tabular-nums " + (warn ? "text-amber-600 dark:text-amber-500" : accent ? "text-brand" : "text-foreground")}>
        {value}
      </div>
    </div>
  );
}

function Empty({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed py-14 text-center">
      <div className="flex size-12 items-center justify-center rounded-xl bg-muted text-muted-foreground">
        <PackageX className="size-6" />
      </div>
      <div>
        <div className="font-medium">{title}</div>
        <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">{body}</p>
      </div>
    </div>
  );
}
