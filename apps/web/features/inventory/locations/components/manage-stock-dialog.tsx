"use client";

import { ArrowLeftRight, PackageX, Undo2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatMoney } from "@/features/inventory/products/lib";
import { useLocationStockView } from "../hooks";
import type { LocationRow } from "../lib";

export function ManageStockDialog({
  location,
  open,
  onOpenChange,
}: {
  location: LocationRow;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const { rows, totals, isLoading, isError } = useLocationStockView(location);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-hidden sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{location.name}</DialogTitle>
          <DialogDescription>
            {location.description || "Everything currently stocked here."}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 sm:grid-cols-3">
          <Stat label="On hand" value={totals.onHand.toLocaleString()} />
          <Stat label="Total items cost" value={formatMoney(totals.totalCost)} />
          <Stat label="Sale items value" value={formatMoney(totals.saleValue)} accent />
        </div>

        {isLoading ? (
          <Skeleton className="h-56 w-full" />
        ) : isError ? (
          <p className="py-10 text-center text-sm text-muted-foreground">
            Couldn&apos;t load this location&apos;s stock. Try again shortly.
          </p>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-10 text-center">
            <PackageX className="size-6 text-muted-foreground" />
            <p className="text-sm font-medium">Nothing stocked here</p>
            <p className="text-sm text-muted-foreground">
              Move items in from another location to fill it.
            </p>
          </div>
        ) : (
          <div className="max-h-[45vh] overflow-auto rounded-lg border">
            <Table>
              <TableHeader className="sticky top-0 bg-background">
                <TableRow className="hover:bg-transparent">
                  <TableHead>Product name</TableHead>
                  <TableHead className="text-right">Quantity</TableHead>
                  <TableHead className="text-right">Price</TableHead>
                  <TableHead className="text-right">Cost</TableHead>
                  <TableHead className="w-24 text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.productId}>
                    <TableCell>
                      <div className="font-medium">{row.name}</div>
                      {row.sku ? (
                        <div className="text-xs text-muted-foreground">{row.sku}</div>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      <span className="inline-flex items-center gap-2">
                        {row.isLow ? <Badge variant="destructive">Low</Badge> : null}
                        {row.quantity.toLocaleString()}
                      </span>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatMoney(row.price)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatMoney(row.cost)}
                    </TableCell>
                    <TableCell className="text-right">
                      {/*
                        Move and Return are rendered but deliberately unwired —
                        the Move Item flow lands in its own change.
                      */}
                      <div className="flex justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-8"
                          aria-label={`Move ${row.name}`}
                        >
                          <ArrowLeftRight className="size-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-8"
                          aria-label={`Return ${row.name}`}
                        >
                          <Undo2 className="size-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Stat({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div className="rounded-lg border px-3 py-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div
        className={`text-lg font-semibold tabular-nums ${accent ? "text-brand" : ""}`}
      >
        {value}
      </div>
    </div>
  );
}
