"use client";

import { Boxes, PackageX, Truck, Warehouse as WarehouseIcon } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { useProductStock } from "../stock";

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

  if (serviceType) {
    return (
      <EmptyBlock
        icon={<Boxes className="size-6" />}
        title="Services aren't stocked"
        body="This is a service — it has no inventory across warehouses or containers."
      />
    );
  }

  if (stock.loading) {
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

  const belowMin = minStockLevel > 0 && stock.total <= minStockLevel;

  return (
    <div className="space-y-5">
      {/* Summary */}
      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard label="On hand" value={String(stock.total)} accent>
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
        <StatCard label="Locations" value={String(stock.rows.length)} />
      </div>

      {stock.isEmpty || stock.rows.length === 0 ? (
        <EmptyBlock
          icon={<PackageX className="size-6" />}
          title="Not stocked anywhere yet"
          body="This product isn't in any warehouse or container. Receive it into a warehouse or transfer it to a container to build stock."
        />
      ) : (
        <div className="overflow-hidden rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Location</TableHead>
                <TableHead>Type</TableHead>
                <TableHead className="text-right">On hand</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {stock.rows.map((row) => (
                <TableRow key={`${row.kind}-${row.id}`} className="hover:bg-muted/40">
                  <TableCell>
                    <div className="flex items-center gap-2.5">
                      <span
                        className={cn(
                          "flex size-8 flex-none items-center justify-center rounded-lg border",
                          row.kind === "warehouse"
                            ? "bg-brand/10 text-brand"
                            : "bg-muted text-muted-foreground",
                        )}
                      >
                        {row.kind === "warehouse" ? (
                          <WarehouseIcon className="size-4" />
                        ) : (
                          <Truck className="size-4" />
                        )}
                      </span>
                      <div className="min-w-0">
                        <div className="truncate font-medium">{row.name}</div>
                        {row.subtitle ? (
                          <div className="truncate text-xs text-muted-foreground">
                            {row.subtitle}
                          </div>
                        ) : null}
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className="font-normal capitalize">
                      {row.kind}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right font-medium tabular-nums">
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
