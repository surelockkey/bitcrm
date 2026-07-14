"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2, Package, PackageX, Search, TriangleAlert } from "lucide-react";
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
import { cn } from "@/lib/utils";
import { queryKeys } from "@/lib/query-keys";
import { fetchAllProducts } from "@/features/inventory/warehouses/api";
import { listContainers, getContainerStock } from "@/features/inventory/containers/api";
import { useUserMap, useAddProduct } from "../hooks";
import { formatMoney, isPriceInBand, priceRange } from "../lib";

/** Fetch the assigned technician's container stock as productId → quantity. */
async function fetchTechStock(techId: string): Promise<Map<string, number>> {
  const containers = await listContainers();
  const container = containers.data.find((c) => c.technicianId === techId);
  if (!container) return new Map();
  const stock = await getContainerStock(container.id);
  return new Map(stock.map((s) => [s.productId, s.quantity]));
}

export function AddProductDialog({
  dealId,
  techId,
  open,
  onOpenChange,
}: {
  dealId: string;
  techId?: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const catalog = useQuery({
    queryKey: queryKeys.inventory.products.map(),
    queryFn: fetchAllProducts,
    enabled: open,
  });
  const stockQuery = useQuery({
    queryKey: ["deal-tech-stock", techId],
    queryFn: () => fetchTechStock(techId!),
    enabled: open && !!techId,
    retry: false,
  });
  const { map: userMap } = useUserMap();
  const add = useAddProduct(dealId);
  const [search, setSearch] = useState("");
  const [picked, setPicked] = useState<Product | null>(null);

  const reset = () => { setPicked(null); setSearch(""); };

  const tech = techId ? userMap.get(techId) : undefined;
  const techName = tech ? `${tech.firstName} ${tech.lastName}` : "the assigned technician";
  const stockMap = stockQuery.data;
  const stockKnown = stockQuery.isSuccess;
  const availOf = (id: string) => stockMap?.get(id) ?? 0;

  const products = useMemo(() => {
    const active = (catalog.data ?? []).filter((p) => p.status === InventoryStatus.ACTIVE);
    const s = search.trim().toLowerCase();
    const filtered = s ? active.filter((p) => `${p.name} ${p.sku}`.toLowerCase().includes(s)) : active;
    if (!stockMap) return filtered;
    // Show what the tech actually carries first.
    return [...filtered].sort((a, b) => (stockMap.get(b.id) ?? 0) - (stockMap.get(a.id) ?? 0));
  }, [catalog.data, search, stockMap]);

  const pickedAvail = picked ? availOf(picked.id) : 0;

  return (
    <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) reset(); }}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{picked ? "Add to deal" : "Add a product"}</DialogTitle>
        </DialogHeader>

        {picked ? (
          <Configure
            product={picked}
            available={pickedAvail}
            stockKnown={stockKnown}
            techName={techName}
            pending={add.isPending}
            onBack={() => setPicked(null)}
            onAdd={(v) => add.mutate(v, { onSuccess: () => { onOpenChange(false); reset(); } })}
          />
        ) : (
          <>
            <p className="text-[11px] text-muted-foreground">
              Products are deducted from {techName}&apos;s container. Items they don&apos;t carry can&apos;t be added to the deal.
            </p>
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
                products.map((p) => {
                  const avail = availOf(p.id);
                  const carried = !stockKnown || avail > 0;
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => setPicked(p)}
                      className={cn(
                        "flex w-full items-center gap-2.5 rounded-lg border p-2 text-left hover:bg-accent/50",
                        stockKnown && avail === 0 && "opacity-60",
                      )}
                    >
                      <span className={cn("grid size-7 flex-none place-items-center rounded-md border", carried ? "bg-muted text-muted-foreground" : "bg-destructive/10 text-destructive")}>
                        {carried ? <Package className="size-3.5" /> : <PackageX className="size-3.5" />}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium">{p.name}</div>
                        <div className="truncate font-mono text-[11px] text-muted-foreground">{p.sku}</div>
                      </div>
                      {stockKnown ? (
                        <span className={cn("flex-none rounded-full px-1.5 py-0.5 text-[10px] font-semibold", avail > 0 ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300" : "bg-muted text-muted-foreground")}>
                          {avail > 0 ? `In van · ${avail}` : "Not in van"}
                        </span>
                      ) : null}
                      <span className="flex-none font-mono text-sm tabular-nums">{formatMoney(p.priceClient)}</span>
                    </button>
                  );
                })
              )}
            </div>
            {stockQuery.isLoading ? (
              <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground"><Loader2 className="size-3 animate-spin" /> Checking {techName}&apos;s van…</p>
            ) : stockQuery.isError ? (
              <p className="text-[11px] text-muted-foreground">Couldn&apos;t load the technician&apos;s stock — you can still try to add; the server will confirm availability.</p>
            ) : null}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Configure({
  product,
  available,
  stockKnown,
  techName,
  pending,
  onBack,
  onAdd,
}: {
  product: Product;
  available: number;
  stockKnown: boolean;
  techName: string;
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
  const shortStock = stockKnown && qty > available;
  const blocked = !inBand || shortStock;

  return (
    <div className="space-y-4">
      <div className="rounded-lg border p-3">
        <div className="text-sm font-medium">{product.name}</div>
        <div className="font-mono text-[11px] text-muted-foreground">{product.sku} · catalog {formatMoney(product.priceClient)}</div>
        {stockKnown ? (
          <div className={cn("mt-1 text-[11px]", available > 0 ? "text-muted-foreground" : "text-destructive")}>
            {techName} has {available} in their van
          </div>
        ) : null}
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
      {shortStock ? (
        <div className="flex items-start gap-1.5 rounded-lg border border-destructive/30 bg-destructive/5 px-2.5 py-2 text-[11px] text-destructive">
          <TriangleAlert className="mt-px size-3.5 flex-none" />
          <span>{techName} only has {available} of this in their van. Transfer stock to their container first, or reduce the quantity.</span>
        </div>
      ) : null}
      <div className="flex items-center justify-between border-t pt-3">
        <Button variant="ghost" size="sm" onClick={onBack}>← Back</Button>
        <div className="flex items-center gap-3">
          <span className="font-mono text-sm tabular-nums">{formatMoney(price * qty)}</span>
          <Button variant="brand" size="sm" className="gap-1.5" disabled={pending || blocked}
            onClick={() => onAdd({ productId: product.id, name: product.name, sku: product.sku, quantity: qty, costCompany: product.costCompany, costForTech: product.costTech, priceClient: price })}>
            {pending ? <Loader2 className="size-4 animate-spin" /> : null} Add
          </Button>
        </div>
      </div>
    </div>
  );
}
