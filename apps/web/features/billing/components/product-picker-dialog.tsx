"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2, Package, Search, Wrench } from "lucide-react";
import { InventoryStatus, ProductType, type Product } from "@bitcrm/types";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { queryKeys } from "@/lib/query-keys";
import { fetchAllProducts } from "@/features/inventory/warehouses/api";
import { formatMoney, isPriceInBand, priceRange } from "@/features/deals/lib";
import { estimateItemSchema, type EstimateItemBody } from "@/features/estimates/schemas";

/** An existing document line being edited. */
export interface PickerLine {
  productId: string;
  productType?: ProductType;
  name: string;
  sku: string;
  description?: string;
  quantity: number;
  priceClient: number;
  costCompany: number;
  costForTech: number;
  taxable: boolean;
}

/**
 * Catalog picker for document lines (estimates). Same catalog cache and
 * price band as the job's Add item dialog, without the van-stock sourcing —
 * an estimate reserves nothing until it is synced to the job.
 */
export function ProductPickerDialog({
  open,
  onOpenChange,
  onSubmit,
  editing,
  pending,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (body: EstimateItemBody) => void;
  editing?: PickerLine;
  pending?: boolean;
}) {
  const catalog = useQuery({
    queryKey: queryKeys.inventory.products.map(),
    queryFn: fetchAllProducts,
    enabled: open,
  });
  const [search, setSearch] = useState("");
  const [picked, setPicked] = useState<Product | null>(null);
  const [changing, setChanging] = useState(false);

  const reset = () => {
    setSearch("");
    setPicked(null);
    setChanging(false);
  };

  const products = useMemo(() => {
    const active = (catalog.data ?? []).filter((p) => p.status === InventoryStatus.ACTIVE);
    const s = search.trim().toLowerCase();
    return s ? active.filter((p) => `${p.name} ${p.sku}`.toLowerCase().includes(s)) : active;
  }, [catalog.data, search]);

  const editingProduct = editing
    ? ((catalog.data ?? []).find((p) => p.id === editing.productId) ?? null)
    : null;
  // Editing opens on the line itself (even if its product left the catalog).
  const showConfigure = picked !== null || (editing !== undefined && !changing);

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        onOpenChange(v);
        if (!v) reset();
      }}
    >
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{editing ? "Edit item" : picked ? "Add to estimate" : "Add an item"}</DialogTitle>
          <DialogDescription className="sr-only">Pick a catalog product or service</DialogDescription>
        </DialogHeader>

        {showConfigure ? (
          <Configure
            key={picked?.id ?? editing?.productId}
            product={picked ?? editingProduct}
            line={picked ? undefined : editing}
            pending={pending}
            submitLabel={editing ? "Save" : "Add item"}
            backLabel={editing && !picked ? "Change item" : "← Back"}
            onBack={() => {
              setPicked(null);
              setChanging(true);
            }}
            onSubmit={(body) => {
              onSubmit(body);
            }}
          />
        ) : (
          <>
            <div className="relative">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="h-9 pl-8"
                placeholder="Search catalog by name or SKU"
                aria-label="Search catalog"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                autoFocus
              />
            </div>
            <div className="max-h-80 space-y-1.5 overflow-y-auto">
              {catalog.isLoading ? (
                <div className="flex items-center gap-2 py-3 text-sm text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" /> Loading catalog…
                </div>
              ) : catalog.isError ? (
                <p className="py-3 text-sm text-destructive">Couldn&apos;t load the catalog.</p>
              ) : products.length === 0 ? (
                <p className="py-3 text-sm text-muted-foreground">No products found.</p>
              ) : (
                products.map((p) => {
                  const isService = p.type === ProductType.SERVICE;
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => setPicked(p)}
                      className="flex w-full items-center gap-2.5 rounded-lg border p-2 text-left hover:bg-accent/50"
                    >
                      <span
                        className={cn(
                          "grid size-7 flex-none place-items-center rounded-md border",
                          isService
                            ? "bg-sky-100 text-sky-700 dark:bg-sky-950/60 dark:text-sky-300"
                            : "bg-muted text-muted-foreground",
                        )}
                      >
                        {isService ? <Wrench className="size-3.5" /> : <Package className="size-3.5" />}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium">{p.name}</div>
                        <div className="truncate font-mono text-[11px] text-muted-foreground">{p.sku}</div>
                      </div>
                      <span className="flex-none font-mono text-sm tabular-nums">{formatMoney(p.priceClient)}</span>
                    </button>
                  );
                })
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
  line,
  pending,
  submitLabel,
  backLabel,
  onBack,
  onSubmit,
}: {
  /** Catalog entry (null when an edited line's product left the catalog). */
  product: Product | null;
  line?: PickerLine;
  pending?: boolean;
  submitLabel: string;
  backLabel: string;
  onBack: () => void;
  onSubmit: (body: EstimateItemBody) => void;
}) {
  const [qty, setQty] = useState(String(line?.quantity ?? 1));
  const [price, setPrice] = useState(String(line?.priceClient ?? product?.priceClient ?? 0));
  const [taxable, setTaxable] = useState(line ? line.taxable : product?.taxable !== false);
  const [description, setDescription] = useState(line?.description ?? "");

  const catalogPrice = product?.priceClient;
  const priceNum = Number(price);
  const inBand = catalogPrice === undefined || isPriceInBand(priceNum, catalogPrice);
  const range = catalogPrice !== undefined ? priceRange(catalogPrice) : null;

  const parsed = estimateItemSchema.safeParse({
    productId: product?.id ?? line?.productId,
    productType: product?.type ?? line?.productType,
    name: product?.name ?? line?.name,
    sku: product?.sku ?? line?.sku ?? "",
    description,
    quantity: qty,
    priceClient: price,
    costCompany: product?.costCompany ?? line?.costCompany ?? 0,
    costForTech: product?.costTech ?? line?.costForTech ?? 0,
    taxable,
  });
  const qtyError = !parsed.success && parsed.error.issues.find((i) => i.path[0] === "quantity")?.message;
  const priceError = !parsed.success && parsed.error.issues.find((i) => i.path[0] === "priceClient")?.message;
  const valid = parsed.success && inBand;

  return (
    <form
      className="space-y-4"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        if (parsed.success && inBand) onSubmit(parsed.data);
      }}
    >
      <div className="rounded-lg border p-3">
        <div className="text-sm font-medium">{product?.name ?? line?.name}</div>
        <div className="font-mono text-[11px] text-muted-foreground">
          {product?.sku ?? line?.sku}
          {catalogPrice !== undefined ? ` · catalog ${formatMoney(catalogPrice)}` : " · no longer in the catalog"}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="picker-qty">Quantity</Label>
          <Input
            id="picker-qty"
            className="h-9"
            type="number"
            inputMode="numeric"
            min={1}
            step={1}
            value={qty}
            aria-invalid={Boolean(qtyError)}
            onChange={(e) => setQty(e.target.value)}
          />
          {qtyError ? <p className="text-[11px] text-destructive">{qtyError}</p> : null}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="picker-price">Client price</Label>
          <Input
            id="picker-price"
            className="h-9"
            type="number"
            inputMode="decimal"
            step="0.01"
            min={0}
            value={price}
            aria-invalid={!inBand || Boolean(priceError)}
            onChange={(e) => setPrice(e.target.value)}
          />
          {priceError ? (
            <p className="text-[11px] text-destructive">{priceError}</p>
          ) : range ? (
            <p className={cn("text-[11px]", inBand ? "text-muted-foreground" : "text-destructive")}>
              Allowed {formatMoney(range.min)}–{formatMoney(range.max)} (±15%)
            </p>
          ) : null}
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="picker-description">
          Description <span className="text-xs font-normal text-muted-foreground">(optional)</span>
        </Label>
        <Textarea
          id="picker-description"
          rows={2}
          maxLength={1000}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Shown to the client on the estimate"
        />
      </div>
      <div className="flex items-center justify-between gap-3 rounded-md border px-3 py-2">
        <Label htmlFor="picker-taxable" className="flex flex-col items-start gap-0.5">
          <span>Taxable</span>
          <span className="text-[11px] font-normal text-muted-foreground">Apply the estimate&apos;s tax rate to this item.</span>
        </Label>
        <Switch id="picker-taxable" checked={taxable} onCheckedChange={setTaxable} />
      </div>
      <div className="flex items-center justify-between border-t pt-3">
        <Button type="button" variant="ghost" size="sm" onClick={onBack}>
          {backLabel}
        </Button>
        <div className="flex items-center gap-3">
          <span className="font-mono text-sm tabular-nums">
            {formatMoney((Number.isFinite(priceNum) ? priceNum : 0) * (Number(qty) || 0))}
          </span>
          <Button type="submit" variant="brand" size="sm" disabled={pending || !valid}>
            {pending ? <Loader2 className="animate-spin" /> : null}
            {submitLabel}
          </Button>
        </div>
      </div>
    </form>
  );
}
