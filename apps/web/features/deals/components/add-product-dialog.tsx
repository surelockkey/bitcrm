"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2, Package, PackageX, Search, TriangleAlert, Wrench } from "lucide-react";
import { InventoryStatus, ProductType } from "@bitcrm/types";
import type { DealProduct, Product } from "@bitcrm/types";
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
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { queryKeys } from "@/lib/query-keys";
import { fetchAllProducts } from "@/features/inventory/warehouses/api";
import { useUserMap, useAddProduct, useReplaceProduct } from "../hooks";
import { fetchTechStock } from "../tech-stock";
import { formatMoney, isPriceInBand, priceBandApplies, priceRange } from "../lib";

export function AddProductDialog({
  dealId,
  techIds,
  open,
  onOpenChange,
  editing,
}: {
  dealId: string;
  /** The deal's assigned technicians — the product is pulled from one of them. */
  techIds: string[];
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** When set, the dialog edits this existing line instead of adding a new one. */
  editing?: DealProduct;
}) {
  const isEdit = !!editing;
  // Which assigned tech supplies this product; an edited line keeps its source.
  const [techId, setTechId] = useState<string | undefined>(techIds[0]);
  useEffect(() => {
    if (open) {
      setTechId(
        editing?.sourceTechId && techIds.includes(editing.sourceTechId)
          ? editing.sourceTechId
          : techIds[0],
      );
    }
  }, [open, techIds, editing]);
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
  const replace = useReplaceProduct(dealId);
  const [search, setSearch] = useState("");
  const [picked, setPicked] = useState<Product | null>(null);
  // Edit mode opens straight on the configure step for the line's catalog
  // product; "Change item" clears this and drops back to the picker.
  const [changingItem, setChangingItem] = useState(false);

  const reset = () => { setPicked(null); setSearch(""); setChangingItem(false); };

  // The catalog entry behind the line being edited (null while loading, or if
  // the product has since left the catalog — then the picker shows instead).
  const editingProduct = useMemo(
    () => (editing ? ((catalog.data ?? []).find((p) => p.id === editing.productId) ?? null) : null),
    [editing, catalog.data],
  );
  const current = picked ?? (isEdit && !changingItem ? editingProduct : null);

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

  // When editing the same sourced line from the same tech, the units already on
  // the line come back to the van before the new quantity is pulled (the server
  // reconciles restore-first) — so they count toward what can be sourced.
  const stockCredit =
    editing &&
    current?.id === editing.productId &&
    (editing.fulfillment ?? "sourced") === "sourced" &&
    techId === editing.sourceTechId
      ? editing.quantity
      : 0;

  const close = () => { onOpenChange(false); reset(); };

  return (
    <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) reset(); }}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit item" : current ? "Add to job" : "Add a product"}</DialogTitle>
        </DialogHeader>

        {current ? (
          <Configure
            key={current.id}
            product={current}
            available={availOf(current.id) + stockCredit}
            stockCredit={stockCredit}
            stockKnown={stockKnown}
            techName={techName}
            techId={techId}
            pending={isEdit ? replace.isPending : add.isPending}
            // The unswapped line offers "Change item" (the Workiz flow); a
            // swapped pick backs out to the picker it came from.
            backLabel={editing && current.id === editing.productId ? "Change item" : undefined}
            submitLabel={isEdit ? "Save" : undefined}
            // A line carried over from Workiz keeps whatever price Workiz
            // recorded — 82% of the historical lines differ from today's
            // catalog price, so the ±15% band must not block saving them.
            bandExempt={!!editing && current.id === editing.productId && !priceBandApplies(editing)}
            initial={
              editing && current.id === editing.productId
                ? {
                    quantity: editing.quantity,
                    price: editing.priceClient,
                    taxable: editing.taxable,
                    description: editing.description,
                  }
                : undefined
            }
            onBack={() => { setPicked(null); setChangingItem(true); }}
            onAdd={(v) => {
              if (editing) {
                replace.mutate({ lineId: editing.lineId, body: v }, { onSuccess: close });
              } else {
                add.mutate(v, { onSuccess: close });
              }
            }}
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
                          "rounded-chip border px-2.5 py-1 text-xs transition-colors",
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
                        <span className="flex-none rounded-chip bg-sky-100 px-1.5 py-0.5 text-[10px] font-semibold text-sky-700 dark:bg-sky-950/60 dark:text-sky-300">
                          Service
                        </span>
                      ) : stockKnown ? (
                        <span className={cn("flex-none rounded-chip px-1.5 py-0.5 text-[10px] font-semibold", avail > 0 ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300" : "bg-muted text-muted-foreground")}>
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
  stockCredit = 0,
  stockKnown,
  techName,
  techId,
  pending,
  backLabel,
  submitLabel,
  bandExempt = false,
  initial,
  onBack,
  onAdd,
}: {
  product: Product;
  /** Units the tech can source — van stock plus any credit from the edited line. */
  available: number;
  /** The share of `available` that is the edited line itself, for the copy. */
  stockCredit?: number;
  stockKnown: boolean;
  techName: string;
  techId: string | undefined;
  pending: boolean;
  backLabel?: string;
  submitLabel?: string;
  /** Imported line: the ±15% band does not judge its price (see priceBandApplies). */
  bandExempt?: boolean;
  /** Prefill when reconfiguring an existing line (edit mode, same product). */
  initial?: { quantity: number; price: number; taxable?: boolean; description?: string };
  onBack: () => void;
  onAdd: (v: AddProductValues) => void;
}) {
  const isService = product.type === ProductType.SERVICE;
  const [qty, setQty] = useState(initial?.quantity ?? 1);
  const storedPrice = initial?.price ?? product.priceClient;
  const [price, setPrice] = useState(storedPrice);
  // Absent flags mean taxable — on the line and on the catalog product alike.
  const [taxable, setTaxable] = useState(initial ? initial.taxable !== false : product.taxable !== false);
  const [description, setDescription] = useState(initial?.description ?? "");
  const { min, max } = priceRange(product.priceClient);
  // The exemption waives the band for the price Workiz recorded — not for
  // whatever the user types next. Same rule the product editor uses for its
  // own waived caps (`updateProductSchemaFor`: a value is only loose while it
  // comes back unchanged). Without the `price === storedPrice` half, any of
  // the 156 612 imported lines would be a permanent hole in the ±15% rule,
  // which is the only client-price guard in the product.
  const exempt = bandExempt && price === storedPrice;
  const inBand = exempt || isPriceInBand(price, product.priceClient);

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
    taxable,
    description: description.trim() || undefined,
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

  const label = submitLabel ?? (isService ? "Add service" : mustOrder ? "Add to order" : "Add");

  return (
    <div className="space-y-4">
      <div className="rounded-lg border p-3">
        <div className="text-sm font-medium">{product.name}</div>
        <div className="font-mono text-[11px] text-muted-foreground">{product.sku} · catalog {formatMoney(product.priceClient)}</div>
        {isService ? (
          <div className="mt-1 text-[11px] text-muted-foreground">Service — not stocked; added directly to the job.</div>
        ) : stockKnown ? (
          <div className={cn("mt-1 text-[11px]", available > 0 ? "text-muted-foreground" : "text-destructive")}>
            {techName} has {available - stockCredit} in their van
            {stockCredit > 0 ? ` (+${stockCredit} on this line)` : ""}
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
          {exempt ? (
            <p className="text-[11px] text-muted-foreground">
              Imported from Workiz — the ±15% band doesn&apos;t apply. Catalog{" "}
              {formatMoney(product.priceClient)}.
            </p>
          ) : (
            <p className={inBand ? "text-[11px] text-muted-foreground" : "text-[11px] text-destructive"}>
              Allowed {formatMoney(min)}–{formatMoney(max)} (±15%)
            </p>
          )}
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="line-description">
          Description <span className="text-xs font-normal text-muted-foreground">(optional)</span>
        </Label>
        <Textarea
          id="line-description"
          rows={2}
          maxLength={1000}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Shown to the client on estimates and invoices"
        />
      </div>
      <div className="flex items-center justify-between gap-3 rounded-md border px-3 py-2">
        <Label htmlFor="line-taxable" className="flex flex-col items-start gap-0.5">
          <span>Taxable</span>
          <span className="text-[11px] font-normal text-muted-foreground">Apply the job&apos;s tax rate to this item.</span>
        </Label>
        <Switch id="line-taxable" checked={taxable} onCheckedChange={setTaxable} />
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
        <Button variant="ghost" size="sm" onClick={onBack}>{backLabel ?? "← Back"}</Button>
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
