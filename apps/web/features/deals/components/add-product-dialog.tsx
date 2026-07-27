"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2, Package, PackageX, Search, TriangleAlert, Wrench } from "lucide-react";
import { InventoryStatus, ProductType } from "@bitcrm/types";
import type { Product } from "@bitcrm/types";
import type { AddProductValues } from "../schemas";
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
import { useUserMap, useAddProduct } from "../hooks";
import { fetchTechStock } from "../tech-stock";
import { formatMoney, isPriceInBand, priceRange } from "../lib";

export function AddProductDialog({
  dealId,
  techIds,
  open,
  onOpenChange,
}: {
  dealId: string;
  /** The deal's assigned technicians — the product is pulled from one of them. */
  techIds: string[];
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  // Which assigned tech supplies this product; defaults to the first.
  const [techId, setTechId] = useState<string | undefined>(techIds[0]);
  useEffect(() => { if (open) setTechId(techIds[0]); }, [open, techIds]);
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
            techId={techId}
            pending={add.isPending}
            onBack={() => setPicked(null)}
            onAdd={(v) => add.mutate(v, { onSuccess: () => { onOpenChange(false); reset(); } })}
          />
        ) : (
          <>
            {techIds.length > 1 ? (
              <div className="space-y-1.5">
                <Label className="text-xs">Take from</Label>
                <div className="flex flex-wrap gap-1.5">
                  {techIds.map((id) => {
                    const u = userMap.get(id);
                    const label = u ? `${u.firstName} ${u.lastName}` : id;
                    return (
                      <button
                        key={id}
                        type="button"
                        onClick={() => { setTechId(id); setPicked(null); }}
                        className={cn(
                          "rounded-full border px-2.5 py-1 text-xs transition-colors",
                          id === techId ? "border-primary bg-primary/10 font-medium" : "hover:bg-muted/50",
                        )}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : null}
            <p className="text-[11px] text-muted-foreground">
              Parts in {techName}&apos;s van are deducted from their container. Parts they
              don&apos;t carry can be added as items to order; services are added directly.
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
                  const isService = p.type === ProductType.SERVICE;
                  const avail = availOf(p.id);
                  const carried = !stockKnown || avail > 0;
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => setPicked(p)}
                      className={cn(
                        "flex w-full items-center gap-2.5 rounded-lg border p-2 text-left hover:bg-accent/50",
                        !isService && stockKnown && avail === 0 && "opacity-60",
                      )}
                    >
                      <span className={cn(
                        "grid size-7 flex-none place-items-center rounded-md border",
                        isService
                          ? "bg-sky-100 text-sky-700 dark:bg-sky-950/60 dark:text-sky-300"
                          : carried ? "bg-muted text-muted-foreground" : "bg-destructive/10 text-destructive",
                      )}>
                        {isService ? <Wrench className="size-3.5" /> : carried ? <Package className="size-3.5" /> : <PackageX className="size-3.5" />}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium">{p.name}</div>
                        <div className="truncate font-mono text-[11px] text-muted-foreground">{p.sku}</div>
                      </div>
                      {isService ? (
                        <span className="flex-none rounded-full bg-sky-100 px-1.5 py-0.5 text-[10px] font-semibold text-sky-700 dark:bg-sky-950/60 dark:text-sky-300">
                          Service
                        </span>
                      ) : stockKnown ? (
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
  techId,
  pending,
  onBack,
  onAdd,
}: {
  product: Product;
  available: number;
  stockKnown: boolean;
  techName: string;
  techId: string | undefined;
  pending: boolean;
  onBack: () => void;
  onAdd: (v: AddProductValues) => void;
}) {
  const isService = product.type === ProductType.SERVICE;
  const [qty, setQty] = useState(1);
  const [price, setPrice] = useState(product.priceClient);
  const { min, max } = priceRange(product.priceClient);
  const inBand = isPriceInBand(price, product.priceClient);

  // A stockable part the chosen tech is short on — or with no tech to source
  // from — is added as a to-order line instead of a van deduction.
  const shortStock = !isService && stockKnown && qty > available;
  const mustOrder = !isService && (!techId || shortStock);

  const base = {
    productId: product.id,
    name: product.name,
    sku: product.sku,
    quantity: qty,
    costCompany: product.costCompany,
    costForTech: product.costTech,
    priceClient: price,
  };

  const submit = () => {
    if (isService) {
      onAdd({ ...base, fulfillment: "service" });
    } else if (mustOrder) {
      onAdd({ ...base, fulfillment: "to_order" });
    } else {
      onAdd({ ...base, fulfillment: "sourced", sourceTechId: techId });
    }
  };

  const label = isService ? "Add service" : mustOrder ? "Add to order" : "Add";

  return (
    <div className="space-y-4">
      <div className="rounded-lg border p-3">
        <div className="text-sm font-medium">{product.name}</div>
        <div className="font-mono text-[11px] text-muted-foreground">{product.sku} · catalog {formatMoney(product.priceClient)}</div>
        {isService ? (
          <div className="mt-1 text-[11px] text-muted-foreground">Service — not stocked; added directly to the job.</div>
        ) : stockKnown ? (
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
      {mustOrder ? (
        <div className="flex items-start gap-1.5 rounded-lg border border-amber-500/30 bg-amber-500/10 px-2.5 py-2 text-[11px] text-amber-700 dark:text-amber-400">
          <TriangleAlert className="mt-px size-3.5 flex-none" />
          <span>
            {techId
              ? `${techName} ${available > 0 ? `only has ${available}` : "doesn’t carry this"} in their van`
              : "No technician is assigned to source this from"}
            . It will be added as an item to order (no stock deducted).
          </span>
        </div>
      ) : null}
      <div className="flex items-center justify-between border-t pt-3">
        <Button variant="ghost" size="sm" onClick={onBack}>← Back</Button>
        <div className="flex items-center gap-3">
          <span className="font-mono text-sm tabular-nums">{formatMoney(price * qty)}</span>
          <Button variant="brand" size="sm" className="gap-1.5" disabled={pending || !inBand}
            onClick={submit}>
            {pending ? <Loader2 className="size-4 animate-spin" /> : null} {label}
          </Button>
        </div>
      </div>
    </div>
  );
}
