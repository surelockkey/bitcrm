"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2, Package, Search } from "lucide-react";
import { InventoryStatus } from "@bitcrm/types";
import type { Product } from "@bitcrm/types";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { queryKeys } from "@/lib/query-keys";
import { fetchAllProducts } from "@/features/inventory/warehouses/api";
import { useAddProduct } from "../hooks";
import { formatMoney, isPriceInBand, priceRange } from "../lib";

export function AddProductDialog({
  dealId,
  open,
  onOpenChange,
}: {
  dealId: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const catalog = useQuery({
    queryKey: queryKeys.inventory.products.map(),
    queryFn: fetchAllProducts,
    enabled: open,
  });
  const add = useAddProduct(dealId);
  const [search, setSearch] = useState("");
  const [picked, setPicked] = useState<Product | null>(null);

  const reset = () => { setPicked(null); setSearch(""); };

  const products = useMemo(() => {
    const active = (catalog.data ?? []).filter((p) => p.status === InventoryStatus.ACTIVE);
    const s = search.trim().toLowerCase();
    if (!s) return active;
    return active.filter((p) => `${p.name} ${p.sku}`.toLowerCase().includes(s));
  }, [catalog.data, search]);

  return (
    <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) reset(); }}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{picked ? "Add to deal" : "Add a product"}</DialogTitle>
        </DialogHeader>

        {picked ? (
          <Configure product={picked} pending={add.isPending} onBack={() => setPicked(null)} onAdd={(v) => add.mutate(v, { onSuccess: () => { onOpenChange(false); reset(); } })} />
        ) : (
          <>
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input className="h-9 pl-8" placeholder="Search catalog by name or SKU" value={search} onChange={(e) => setSearch(e.target.value)} autoFocus />
            </div>
            <div className="max-h-72 space-y-1.5 overflow-y-auto">
              {catalog.isLoading ? (
                <div className="flex items-center gap-2 py-3 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" /> Loading catalog…</div>
              ) : products.length === 0 ? (
                <p className="py-3 text-sm text-muted-foreground">No products found.</p>
              ) : (
                products.map((p) => (
                  <button key={p.id} type="button" onClick={() => setPicked(p)} className="flex w-full items-center gap-2.5 rounded-lg border p-2 text-left hover:bg-accent/50">
                    <span className="grid size-7 flex-none place-items-center rounded-md border bg-muted text-muted-foreground"><Package className="size-3.5" /></span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">{p.name}</div>
                      <div className="truncate font-mono text-[11px] text-muted-foreground">{p.sku}</div>
                    </div>
                    <span className="font-mono text-sm tabular-nums">{formatMoney(p.priceClient)}</span>
                  </button>
                ))
              )}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Configure({
  product,
  pending,
  onBack,
  onAdd,
}: {
  product: Product;
  pending: boolean;
  onBack: () => void;
  onAdd: (v: {
    productId: string; name: string; sku: string; quantity: number;
    costCompany: number; costForTech: number; priceClient: number;
  }) => void;
}) {
  const [qty, setQty] = useState(1);
  const [price, setPrice] = useState(product.priceClient);
  const { min, max } = priceRange(product.priceClient);
  const inBand = isPriceInBand(price, product.priceClient);

  return (
    <div className="space-y-4">
      <div className="rounded-lg border p-3">
        <div className="text-sm font-medium">{product.name}</div>
        <div className="font-mono text-[11px] text-muted-foreground">{product.sku} · catalog {formatMoney(product.priceClient)}</div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label>Quantity</Label>
          <Input className="h-9" type="number" min={1} value={qty} onChange={(e) => setQty(Math.max(1, Number(e.target.value) || 1))} />
        </div>
        <div className="space-y-1.5">
          <Label>Client price</Label>
          <Input className="h-9" type="number" step="0.01" value={price} onChange={(e) => setPrice(Number(e.target.value))} />
          <p className={inBand ? "text-[11px] text-muted-foreground" : "text-[11px] text-destructive"}>
            Allowed {formatMoney(min)}–{formatMoney(max)} (±15%)
          </p>
        </div>
      </div>
      <div className="flex items-center justify-between border-t pt-3">
        <Button variant="ghost" size="sm" onClick={onBack}>← Back</Button>
        <div className="flex items-center gap-3">
          <span className="font-mono text-sm tabular-nums">{formatMoney(price * qty)}</span>
          <Button variant="brand" size="sm" className="gap-1.5" disabled={pending || !inBand}
            onClick={() => onAdd({ productId: product.id, name: product.name, sku: product.sku, quantity: qty, costCompany: product.costCompany, costForTech: product.costTech, priceClient: price })}>
            {pending ? <Loader2 className="size-4 animate-spin" /> : null} Add
          </Button>
        </div>
      </div>
    </div>
  );
}
