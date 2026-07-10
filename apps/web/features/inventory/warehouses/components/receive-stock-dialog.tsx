"use client";

import { useMemo, useState } from "react";
import { Loader2, Plus, Search, X } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Product } from "@bitcrm/types";
import { useProductMap, useReceiveStock } from "../hooks";

interface Row {
  product: Product;
  quantity: number;
}

export function ReceiveStockDialog({
  warehouseId,
  warehouseName,
  open,
  onOpenChange,
}: {
  warehouseId: string;
  warehouseName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { data: productMap } = useProductMap(open);
  const receive = useReceiveStock();
  const [rows, setRows] = useState<Row[]>([]);
  const [search, setSearch] = useState("");

  const products = useMemo(() => (productMap ? [...productMap.values()] : []), [productMap]);
  const chosen = new Set(rows.map((r) => r.product.id));
  const matches = search
    ? products
        .filter((p) => !chosen.has(p.id))
        .filter((p) => `${p.name} ${p.sku}`.toLowerCase().includes(search.toLowerCase()))
        .slice(0, 6)
    : [];

  const close = (o: boolean) => {
    if (!o) {
      setRows([]);
      setSearch("");
    }
    onOpenChange(o);
  };

  const add = (p: Product) => {
    setRows((r) => [...r, { product: p, quantity: 1 }]);
    setSearch("");
  };
  const setQty = (id: string, q: number) =>
    setRows((r) => r.map((row) => (row.product.id === id ? { ...row, quantity: q } : row)));
  const remove = (id: string) => setRows((r) => r.filter((row) => row.product.id !== id));

  const units = rows.reduce((n, r) => n + (r.quantity || 0), 0);
  const valid = rows.length > 0 && rows.every((r) => r.quantity >= 1);

  const submit = () => {
    receive.mutate(
      {
        id: warehouseId,
        items: rows.map((r) => ({
          productId: r.product.id,
          productName: r.product.name,
          quantity: r.quantity,
        })),
      },
      { onSuccess: () => close(false) },
    );
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Receive stock</DialogTitle>
          <DialogDescription>
            Into <b>{warehouseName}</b>, from a supplier.
          </DialogDescription>
        </DialogHeader>

        <div className="relative">
          <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search the catalog to add a product…"
            className="h-10 pl-8"
          />
          {matches.length > 0 ? (
            <div className="absolute z-10 mt-1 w-full overflow-hidden rounded-lg border bg-popover shadow-md">
              {matches.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => add(p)}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-accent"
                >
                  <Plus className="size-3.5 text-muted-foreground" />
                  <span className="flex-1 truncate">{p.name}</span>
                  <span className="font-mono text-xs text-muted-foreground">{p.sku}</span>
                </button>
              ))}
            </div>
          ) : null}
        </div>

        {rows.length > 0 ? (
          <div className="max-h-64 divide-y overflow-y-auto rounded-lg border">
            {rows.map((r) => (
              <div key={r.product.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{r.product.name}</div>
                  <div className="font-mono text-[11px] text-muted-foreground">{r.product.sku}</div>
                </div>
                <Input
                  type="number"
                  min={1}
                  value={r.quantity}
                  onChange={(e) => setQty(r.product.id, Number(e.target.value))}
                  className="h-8 w-20 text-center tabular-nums"
                />
                <Button variant="ghost" size="icon" className="size-7" onClick={() => remove(r.product.id)}>
                  <X className="size-4" />
                </Button>
              </div>
            ))}
          </div>
        ) : (
          <p className="rounded-lg border border-dashed px-3 py-6 text-center text-sm text-muted-foreground">
            No products added yet.
          </p>
        )}

        <DialogFooter className="items-center sm:justify-between">
          <span className="text-xs text-muted-foreground">
            {rows.length} {rows.length === 1 ? "product" : "products"} · {units} units
          </span>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => close(false)}>
              Cancel
            </Button>
            <Button
              variant="brand"
              className="gap-1.5"
              disabled={!valid || receive.isPending}
              onClick={submit}
            >
              {receive.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
              Receive
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
