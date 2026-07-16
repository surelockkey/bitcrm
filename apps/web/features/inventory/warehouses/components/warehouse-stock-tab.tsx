"use client";

import { PackageX } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { usePermissions } from "@/features/auth/use-permissions";
import { useWarehouseStockView } from "../hooks";
import { formatMoney } from "../lib";
import type { TransferTarget } from "./transfer-stock-dialog";

export function WarehouseStockTab({
  warehouseId,
  onTransfer,
}: {
  warehouseId: string;
  onTransfer: (item: TransferTarget) => void;
}) {
  const { can } = usePermissions();
  const { rows, summary, isLoading, isError } = useWarehouseStockView(warehouseId);
  const canTransfer = can("transfers", "create") && can("containers", "view");

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-16" />
          ))}
        </div>
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (isError) {
    return <Empty title="Couldn't load stock" body="Try again shortly." />;
  }

  if (rows.length === 0) {
    return (
      <Empty
        title="No stock yet"
        body="Nothing on the shelf. Use “Receive stock” to bring product in from a supplier."
      />
    );
  }

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-4">
        <Stat label="SKUs" value={summary.skuCount.toLocaleString()} />
        <Stat label="On hand" value={summary.totalUnits.toLocaleString()} />
        <Stat label="Value" value={formatMoney(summary.totalValue)} accent />
        <Stat
          label="Low stock"
          value={String(summary.lowCount)}
          warn={summary.lowCount > 0}
        />
      </div>

      <div className="overflow-hidden rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Product</TableHead>
              <TableHead>Category</TableHead>
              <TableHead className="text-right">On hand</TableHead>
              <TableHead className="text-right">Unit</TableHead>
              <TableHead className="text-right">Value</TableHead>
              <TableHead className="w-8" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.productId} className="hover:bg-muted/40">
                <TableCell>
                  <div className="font-medium">{r.name}</div>
                  {r.sku ? <div className="font-mono text-[11px] text-muted-foreground">{r.sku}</div> : null}
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">{r.category ?? "—"}</TableCell>
                <TableCell className="text-right">
                  {r.isLow ? (
                    <Badge
                      variant="outline"
                      className="gap-1 border-amber-500/30 font-normal tabular-nums text-amber-600 dark:text-amber-500"
                    >
                      {r.quantity} · low
                    </Badge>
                  ) : (
                    <span className="tabular-nums">{r.quantity}</span>
                  )}
                </TableCell>
                <TableCell className="text-right tabular-nums text-muted-foreground">
                  {r.unitPrice != null ? formatMoney(r.unitPrice) : "—"}
                </TableCell>
                <TableCell className="text-right font-medium tabular-nums">
                  {r.value != null ? formatMoney(r.value) : "—"}
                </TableCell>
                <TableCell className="text-right">
                  {canTransfer ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="gap-1 text-xs"
                      onClick={() =>
                        onTransfer({
                          productId: r.productId,
                          productName: r.name,
                          onHand: r.quantity,
                        })
                      }
                    >
                      Transfer ↗
                    </Button>
                  ) : null}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
          <TableFooter>
            <TableRow className="hover:bg-transparent">
              <TableCell>{summary.skuCount} SKUs</TableCell>
              <TableCell />
              <TableCell className="text-right tabular-nums">{summary.totalUnits.toLocaleString()}</TableCell>
              <TableCell />
              <TableCell className="text-right tabular-nums">{formatMoney(summary.totalValue)}</TableCell>
              <TableCell />
            </TableRow>
          </TableFooter>
        </Table>
      </div>

      <p className="text-xs text-muted-foreground">
        SKU, category, unit price and low-stock flags are joined from the product catalog.
        Value is on-hand × client price.
      </p>
    </div>
  );
}

function Stat({
  label,
  value,
  accent,
  warn,
}: {
  label: string;
  value: string;
  accent?: boolean;
  warn?: boolean;
}) {
  return (
    <div className="rounded-lg border bg-card p-3.5">
      <div className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">{label}</div>
      <div
        className={
          "mt-0.5 text-xl font-semibold tabular-nums " +
          (warn ? "text-amber-600 dark:text-amber-500" : accent ? "text-brand" : "text-foreground")
        }
      >
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
