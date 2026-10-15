"use client";

import { useMemo, useState } from "react";
import { Loader2, Package, Search, Wrench } from "lucide-react";
import { ProductType, type ItemGroup, type Product } from "@bitcrm/types";
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
import { getApiErrorMessage } from "@/lib/api/errors";
import { cn } from "@/lib/utils";
import { usePermissions } from "@/features/auth/use-permissions";
import { formatMoney } from "@/features/deals/lib";
import { amountOf, markupPct, money2, priceFromMarkup } from "@/features/deals/line-item-math";
import { estimateItemSchema, type EstimateItemBody } from "@/features/estimates/schemas";
import { CATALOG_PAGE_SIZE, useCatalogProduct, useCatalogProducts, useCatalogSearch } from "@/features/price-book/catalog-search";
import { useItemGroups } from "@/features/price-book/item-groups/hooks";
import { groupEstimateLines, pickableGroups } from "@/features/price-book/item-groups/lib";
import { ItemGroupChoices, ItemGroupConfirm } from "@/features/price-book/item-groups/item-group-picker";

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

interface PickerProps {
  onSubmit: (body: EstimateItemBody) => void;
  editing?: PickerLine;
  pending?: boolean;
  /**
   * Given, the picker offers the item groups too (Workiz: groups go on
   * estimates and invoices in one click) and hands back the group's lines,
   * ready to add one by one.
   */
  onAddGroup?: (lines: EstimateItemBody[]) => void;
}

/**
 * Catalog picker for document lines (estimates). Same catalog search as the
 * job's Add item dialog, without the van-stock sourcing — an estimate
 * reserves nothing until it is synced to the job. The price is anyone's to
 * set, below zero too (owner, 2026-10-15); the Markup % and Cost boxes (the
 * line's own company cost, as on the job's card) are the office's.
 *
 * What was typed and what was picked live in the body, which the dialog
 * mounts afresh on every open: a page that closes the picker by its own
 * state (the estimate's, once a line is added) never went through
 * onOpenChange, and a reset hung on it left the next open on the previous
 * product's step (QA 2026-10-14, web-flows 4.6).
 */
export function ProductPickerDialog({
  open,
  onOpenChange,
  ...picker
}: PickerProps & {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-md">
        <PickerBody {...picker} />
      </DialogContent>
    </Dialog>
  );
}

function PickerBody({ onSubmit, editing, pending, onAddGroup }: PickerProps) {
  // The Cost and Markup boxes are the office's: inventory hides costCompany
  // from anyone without financials.view.
  const { can } = usePermissions();
  const mayCost = can("financials", "view");
  const [search, setSearch] = useState("");
  const [picked, setPicked] = useState<Product | null>(null);
  const [changing, setChanging] = useState(false);
  const [pickedGroup, setPickedGroup] = useState<ItemGroup | null>(null);
  // Editing opens on the line itself (even if its product left the catalog).
  const showConfigure = picked !== null || (editing !== undefined && !changing);
  // The search runs only while it is on screen — not behind a line's own step.
  const catalog = useCatalogSearch(search, !showConfigure && !pickedGroup);
  // The item behind the line being edited: its catalog price and type.
  const editingQuery = useCatalogProduct(editing?.productId);
  const editingProduct: Product | null | undefined = editingQuery.isError ? null : editingQuery.data;
  const groups = useItemGroups(!!onAddGroup && !editing);
  const matchedGroups = useMemo(
    () => (onAddGroup && !editing ? pickableGroups(groups.data, search) : []),
    [onAddGroup, editing, groups.data, search],
  );
  // A picked group's items, for the SKU, type and costs its lines carry.
  const memberIds = useMemo(() => pickedGroup?.members.map((m) => m.productId) ?? [], [pickedGroup]);
  const members = useCatalogProducts(memberIds);

  return (
    <>
      <DialogHeader>
        <DialogTitle>{editing ? "Edit item" : picked || pickedGroup ? "Add to estimate" : "Add an item"}</DialogTitle>
        <DialogDescription className="sr-only">Pick a catalog product or service</DialogDescription>
      </DialogHeader>

      {pickedGroup && onAddGroup ? (
        <ItemGroupConfirm
          group={pickedGroup}
          submitLabel="Add group"
          pending={pending || members.isPending}
          onBack={() => setPickedGroup(null)}
          onSubmit={() => onAddGroup(groupEstimateLines(pickedGroup, members.map))}
        />
      ) : showConfigure ? (
        <Configure
          key={picked?.id ?? editing?.productId}
          product={picked ?? editingProduct}
          line={picked ? undefined : editing}
          mayCost={mayCost}
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
            <ItemGroupChoices groups={matchedGroups} limit={search.trim() ? undefined : 3} onPick={setPickedGroup} />
            {catalog.isLoading ? (
              <div className="flex items-center gap-2 py-3 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" /> Loading catalog…
              </div>
            ) : catalog.isError ? (
              <div className="py-3 text-sm text-destructive">
                <p>Couldn&apos;t load the catalog.</p>
                <p className="text-xs text-muted-foreground">{getApiErrorMessage(catalog.error)}</p>
              </div>
            ) : catalog.products.length === 0 ? (
              <p className="py-3 text-sm text-muted-foreground">No products found.</p>
            ) : (
              <>
                {/* The last answer stays, dimmed, while the next search runs. */}
                <div className={cn("space-y-1.5", catalog.isStale && "opacity-70")}>
                  {catalog.products.map((p) => {
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
                  })}
                </div>
                {catalog.hasMore ? (
                  <p className="text-[11px] text-muted-foreground">
                    Showing the first {CATALOG_PAGE_SIZE} — type to narrow it down.
                  </p>
                ) : null}
              </>
            )}
          </div>
        </>
      )}
    </>
  );
}

function Configure({
  product,
  line,
  mayCost,
  pending,
  submitLabel,
  backLabel,
  onBack,
  onSubmit,
}: {
  /**
   * Catalog entry: `undefined` while an edited line's item is still being
   * read, `null` when it left the catalog.
   */
  product: Product | null | undefined;
  line?: PickerLine;
  /** The viewer holds `financials.view`: the Cost and Markup boxes are theirs. */
  mayCost: boolean;
  pending?: boolean;
  submitLabel: string;
  backLabel: string;
  onBack: () => void;
  onSubmit: (body: EstimateItemBody) => void;
}) {
  // The line's own costs on an edit — Workiz freezes the cost on the line, so
  // the catalog's never overwrites it; a new line (or a swap) starts from the
  // catalog's. Inventory leaves costCompany out for a viewer without
  // financials.view, hence the fallbacks.
  const baseCost = line ? line.costCompany : (product?.costCompany ?? 0);
  const costForTech = line ? line.costForTech : (product?.costTech ?? 0);
  const storedPrice = line?.priceClient ?? product?.priceClient ?? 0;
  const [qty, setQty] = useState(String(line?.quantity ?? 1));
  const [price, setPrice] = useState(String(storedPrice));
  const [cost, setCost] = useState(String(baseCost));
  const [markup, setMarkup] = useState(() => {
    const m = markupPct(storedPrice, baseCost);
    return m === null ? "" : money2(m);
  });
  const [taxable, setTaxable] = useState(line ? line.taxable : product?.taxable !== false);
  const [description, setDescription] = useState(line?.description ?? "");

  const catalogPrice = product?.priceClient;
  const priceNum = Number(price);
  const costValue = amountOf(cost);

  // Two-way, as the job's card: a markup prices the line from its cost; a
  // price or a cost re-marks it.
  const changePrice = (text: string) => {
    setPrice(text);
    const p = text.trim() === "" ? NaN : Number(text);
    const m = costValue === null ? null : markupPct(p, costValue);
    setMarkup(m === null ? "" : money2(m));
  };
  const changeCost = (text: string) => {
    setCost(text);
    const c = amountOf(text);
    const m = c === null ? null : markupPct(priceNum, c);
    setMarkup(m === null ? "" : money2(m));
  };
  const changeMarkup = (text: string) => {
    setMarkup(text);
    const m = Number(text);
    const p = text.trim() === "" || !Number.isFinite(m) || costValue === null ? null : priceFromMarkup(costValue, m);
    if (p !== null) setPrice(money2(p));
  };

  const parsed = estimateItemSchema.safeParse({
    productId: product?.id ?? line?.productId,
    productType: product?.type ?? line?.productType,
    name: product?.name ?? line?.name,
    sku: product?.sku ?? line?.sku ?? "",
    description,
    quantity: qty,
    priceClient: price,
    // A viewer who cannot see costs keeps the line's (or the catalog's on a new line).
    costCompany: mayCost ? cost : baseCost,
    costForTech,
    taxable,
  });
  const qtyError = !parsed.success && parsed.error.issues.find((i) => i.path[0] === "quantity")?.message;
  const priceError = !parsed.success && parsed.error.issues.find((i) => i.path[0] === "priceClient")?.message;
  const costError = mayCost && !parsed.success && parsed.error.issues.some((i) => i.path[0] === "costCompany");
  // Not before the catalog item is known: the line takes its type and costs from it.
  const valid = parsed.success && product !== undefined;

  return (
    <form
      className="space-y-4"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        if (valid) onSubmit(parsed.data);
      }}
    >
      <div className="rounded-lg border p-3">
        <div className="text-sm font-medium">{product?.name ?? line?.name}</div>
        <div className="font-mono text-[11px] text-muted-foreground">
          {product?.sku ?? line?.sku}
          {product === undefined
            ? ""
            : catalogPrice !== undefined
              ? ` · catalog ${formatMoney(catalogPrice)}`
              : " · no longer in the catalog"}
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
          {/* Any price, below zero too: no `min`, and no decimal keypad (it has no minus key). */}
          <Input
            id="picker-price"
            className="h-9"
            type="number"
            step="0.01"
            value={price}
            aria-invalid={Boolean(priceError)}
            onChange={(e) => changePrice(e.target.value)}
          />
          {priceError ? <p className="text-[11px] text-destructive">{priceError}</p> : null}
        </div>
        {mayCost ? (
          <>
            <div className="space-y-1.5">
              <Label htmlFor="picker-markup">Markup %</Label>
              <Input
                id="picker-markup"
                className="h-9"
                type="number"
                step="0.01"
                value={markup}
                onChange={(e) => changeMarkup(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="picker-cost">Cost</Label>
              <Input
                id="picker-cost"
                className="h-9"
                type="number"
                inputMode="decimal"
                step="0.01"
                min={0}
                value={cost}
                aria-invalid={costError}
                onChange={(e) => changeCost(e.target.value)}
              />
              {costError ? <p className="text-[11px] text-destructive">Cost can&apos;t be negative</p> : null}
            </div>
          </>
        ) : null}
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
