"use client";

import { useMemo } from "react";
import { Boxes, PackageX, Truck, Warehouse as WarehouseIcon } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ResizableHead } from "@/components/ui/resizable-head";
import { useColumnWidths } from "@/lib/table/use-column-widths";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { useProductStock } from "../hooks";

/**
 * The columns, with the width each one starts at — read by both the
 * `<colgroup>` and the headers, so there is one number to change.
 */
const COLUMNS: { id: string; label: string; width: number; className?: string }[] = [
  { id: "location", label: "Location", width: 320 },
  { id: "type", label: "Type", width: 140 },
  { id: "onHand", label: "On hand", width: 120 },
];

const DEFAULT_WIDTHS = Object.fromEntries(COLUMNS.map((c) => [c.id, c.width]));

/** Its own key: where one item sits is a different table from a warehouse's shelf. */
const TABLE_KEY = "inventory-product-stock";

export function ProductStockTab({
  productId,
  minStockLevel,
  serviceType,
}: {
  productId: string;
  minStockLevel: number;
  serviceType: boolean;
}) {
  const stock = useProductStock(productId, !serviceType);
  const { widthOf, setWidth, reset } = useColumnWidths(TABLE_KEY, DEFAULT_WIDTHS);
  // The endpoint lists every location, empty ones too; this tab is where the item sits.
  const rows = useMemo(
    () =>
      (stock.data?.locations ?? [])
        .filter((l) => l.quantity > 0)
        .sort((a, b) => b.quantity - a.quantity),
    [stock.data],
  );
  const total = stock.data?.onHand ?? 0;

  if (serviceType) {
    return (
      <EmptyBlock
        icon={<Boxes className="size-6" />}
        title="Services aren't stocked"
        body="This is a service — it has no inventory across warehouses or containers."
      />
    );
  }

  if (stock.isLoading) {
    return (
      <div className="space-y-4">
        <div className="flex gap-3">
          <Skeleton className="h-20 flex-1" />
          <Skeleton className="h-20 flex-1" />
        </div>
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (stock.isError) {
    return (
      <EmptyBlock
        icon={<PackageX className="size-6" />}
        title="Couldn't load stock"
        body="The warehouse or container data failed to load. Try again shortly."
      />
    );
  }

  const belowMin = minStockLevel > 0 && total <= minStockLevel;

  return (
    <div className="space-y-5">
      {/* Summary */}
      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard label="On hand" value={String(total)} accent>
          {belowMin ? (
            <Badge
              variant="outline"
              className="mt-1 gap-1 border-amber-500/30 font-normal text-amber-600 dark:text-amber-500"
            >
              Low stock
            </Badge>
          ) : minStockLevel > 0 ? (
            <span className="mt-1 text-xs text-muted-foreground">healthy</span>
          ) : null}
        </StatCard>
        <StatCard label="Min level" value={String(minStockLevel)} />
        <StatCard label="Locations" value={String(rows.length)} />
      </div>

      {rows.length === 0 ? (
        <EmptyBlock
          icon={<PackageX className="size-6" />}
          title="Not stocked anywhere yet"
          body="This item isn't in any warehouse or container. Receive it into a warehouse or transfer it to a container to build stock."
        />
      ) : (
        <div className="overflow-hidden border">
          {/* `table-fixed`: the column decides its width, not the longest
              warehouse name — and the reader can drag the edge. */}
          <Table className="table-fixed">
            <colgroup>
              {COLUMNS.map((c) => (
                <col key={c.id} style={{ width: widthOf(c.id) }} />
              ))}
            </colgroup>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                {COLUMNS.map((c) => (
                  <ResizableHead
                    key={c.id}
                    columnId={c.id}
                    label={c.label}
                    width={widthOf(c.id)}
                    onResize={(px) => setWidth(c.id, px)}
                    onReset={reset}
                    className={c.className}
                  />
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={`${row.locationType}-${row.locationId}`} className="hover:bg-muted/40">
                  {/* Every cell clips: under fixed layout one that doesn't
                      spills over the next column instead of widening its own. */}
                  <TableCell className="overflow-hidden">
                    <div className="flex items-center gap-2.5">
                      <span
                        className={cn(
                          "flex size-8 flex-none items-center justify-center rounded-lg border",
                          row.locationType === "warehouse"
                            ? "bg-brand/10 text-brand"
                            : "bg-muted text-muted-foreground",
                        )}
                      >
                        {row.locationType === "warehouse" ? (
                          <WarehouseIcon className="size-4" />
                        ) : (
                          <Truck className="size-4" />
                        )}
                      </span>
                      <div className="min-w-0">
                        <div className="truncate font-medium">{row.name}</div>
                        {row.description ? (
                          <div className="truncate text-xs text-muted-foreground">
                            {row.description}
                          </div>
                        ) : null}
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="overflow-hidden">
                    <Badge variant="outline" className="font-normal capitalize">
                      {row.locationType}
                    </Badge>
                  </TableCell>
                  <TableCell className="truncate font-medium tabular-nums">
                    {row.quantity}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        Read live from warehouses and containers. Quantities update as stock is
        received, transferred, or used on deals.
      </p>
    </div>
  );
}

function StatCard({
  label,
  value,
  accent,
  children,
}: {
  label: string;
  value: string;
  accent?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
        {label}
      </div>
      <div
        className={cn(
          "mt-1 text-2xl font-semibold tabular-nums",
          accent ? "text-brand" : "text-foreground",
        )}
      >
        {value}
      </div>
      {children}
    </div>
  );
}

function EmptyBlock({
  icon,
  title,
  body,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed py-14 text-center">
      <div className="flex size-12 items-center justify-center rounded-xl bg-muted text-muted-foreground">
        {icon}
      </div>
      <div>
        <div className="font-medium">{title}</div>
        <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">{body}</p>
      </div>
    </div>
  );
}
