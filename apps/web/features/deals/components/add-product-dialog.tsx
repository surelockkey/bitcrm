"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2, Package, PackageX, Search, Wrench } from "lucide-react";
import { ProductType } from "@bitcrm/types";
import type { DealProduct, ItemGroup, Product } from "@bitcrm/types";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getApiErrorMessage } from "@/lib/api/errors";
import { cn } from "@/lib/utils";
import { WzDialogContent } from "@/features/inventory/item-edit/wz";
import { useItemAttributes } from "@/features/inventory/item-attributes/hooks";
import { settled } from "@/lib/use-page-ready";
import { useUserMap, useAddProduct, useReplaceProduct, useAddItemGroup } from "../hooks";
import { CATALOG_PAGE_SIZE, useCatalogProduct, useCatalogSearch } from "@/features/price-book/catalog-search";
import { useItemGroups } from "@/features/price-book/item-groups/hooks";
import { pickableGroups } from "@/features/price-book/item-groups/lib";
import { ItemGroupChoices, ItemGroupConfirm } from "@/features/price-book/item-groups/item-group-picker";
import { fetchTechStock } from "../tech-stock";
import { usePermissions } from "@/features/auth/use-permissions";
import { formatMoney, priceBandApplies, priceBandBinds } from "../lib";
import { personName } from "../person-name";
import { JobItemPopup, type JobItemInitial, type JobItemLocation } from "./job-item-popup";

interface AddProductProps {
  dealId: string;
  /** The deal's assigned technicians — the product is pulled from one of them. */
  techIds: string[];
  /** When set, the dialog edits this existing line instead of adding a new one. */
  editing?: DealProduct;
}

/**
 * The job's Add item window (also the job invoice's): the catalog picker — a
 * product or service, or an item group — and then Workiz's "Add job item"
 * card for the chosen item (`JobItemPopup`). One dialog, two windows: the
 * picker in the house dialog, the card in Workiz's.
 *
 * What was typed, picked and chosen lives in the flow, which mounts afresh on
 * every open — so every open starts at the search, empty, however the
 * previous one ended (the estimate's picker once reopened on the previous
 * product's step: QA 2026-10-14, web-flows 4.6).
 */
export function AddProductDialog({
  open,
  onOpenChange,
  ...body
}: AddProductProps & {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open ? <AddProductFlow {...body} onClose={() => onOpenChange(false)} /> : null}
    </Dialog>
  );
}

function AddProductFlow({ dealId, techIds, editing, onClose }: AddProductProps & { onClose: () => void }) {
  const isEdit = !!editing;
  // Which assigned tech supplies this product; an edited line keeps its source.
  const [techId, setTechId] = useState<string | undefined>(() =>
    editing?.sourceTechId && techIds.includes(editing.sourceTechId) ? editing.sourceTechId : techIds[0],
  );
  const [search, setSearch] = useState("");
  const [pickedGroup, setPickedGroup] = useState<ItemGroup | null>(null);
  const [picked, setPicked] = useState<Product | null>(null);
  // Edit mode opens straight on the card for the line's catalog product;
  // "Change item" clears this and drops back to the picker.
  const [changingItem, setChangingItem] = useState(false);
  // The item behind the line being edited: its catalog price and type.
  const editingQuery = useCatalogProduct(editing?.productId);
  // The catalog entry behind the line being edited (null while it is read,
  // or if the product has since left the catalog — then the picker shows instead).
  const editingProduct = (isEdit && editingQuery.data) || null;
  const current = picked ?? (isEdit && !changingItem ? editingProduct : null);
  // Neither step yet: the edited line's item is still being read.
  const readingEdited = isEdit && !changingItem && !picked && editingQuery.isPending;
  // The search runs only while it is on screen — not behind a line's own card.
  const catalog = useCatalogSearch(search, !current && !readingEdited && !pickedGroup);
  const stockQuery = useQuery({
    queryKey: ["deal-tech-stock", techId],
    queryFn: () => fetchTechStock(techId!),
    enabled: !!techId,
    retry: false,
  });
  const { map: userMap, users, isLoading: usersLoading } = useUserMap();
  // The card's own reads: the catalog's custom fields (its bottom), the
  // people for "Sold by", the chosen van's stock (the location's count).
  const attributes = useItemAttributes();
  // Only a technician is held to the ±15% band; the office sets any price.
  // The Cost box is the office's too: inventory hides costCompany from anyone else.
  const { isTechnician, can } = usePermissions();
  const bandBinds = priceBandBinds({ isTechnician });
  const mayCost = can("financials", "view");
  const add = useAddProduct(dealId);
  // Workiz: Add item offers the item groups too — a group adds all its items at once.
  const groups = useItemGroups(!editing);
  const addGroup = useAddItemGroup(dealId);
  const replace = useReplaceProduct(dealId);

  const nameOf = (id: string) => personName(userMap.get(id));
  const techName = (techId && nameOf(techId)) || "the assigned technician";
  const stockMap = stockQuery.data;
  const stockKnown = stockQuery.isSuccess;
  const availOf = (id: string) => stockMap?.get(id) ?? 0;

  const products = useMemo(() => {
    if (!stockMap) return catalog.products;
    // Show what the tech actually carries first.
    return [...catalog.products].sort((a, b) => (stockMap.get(b.id) ?? 0) - (stockMap.get(a.id) ?? 0));
  }, [catalog.products, stockMap]);

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

  const matchedGroups = useMemo(() => pickableGroups(groups.data, search), [groups.data, search]);

  // The card shows whole or not at all: never a card whose bottom (the custom
  // fields) or whose van count drops in a moment later and moves everything.
  // The Items tab reads these ahead (`usePrefetchJobItemCard`), so in practice
  // the wait is nil; an edit shows nothing until then (no "loading" window
  // the card then replaces), a pick keeps the picker on screen.
  const cardReady = settled(attributes) && !usersLoading && (!techId || settled(stockQuery));
  if (readingEdited || (isEdit && !changingItem && !picked && !cardReady)) return null;

  if (current && cardReady) {
    const sameLine = !!editing && current.id === editing.productId;
    // The vans the line can come from: the assigned technicians'. The count
    // is known for the chosen one (its stock is read); the others say none.
    const locations: JobItemLocation[] = techIds.map((id) => ({
      techId: id,
      label: `${nameOf(id) ?? "Technician"}’s van`,
      ...(id === techId && stockKnown ? { available: availOf(current.id) + stockCredit } : {}),
    }));
    const initial: JobItemInitial | undefined = sameLine
      ? {
          name: editing.name,
          quantity: editing.quantity,
          price: editing.priceClient,
          cost: editing.costCompany,
          taxable: editing.taxable,
          description: editing.description,
          soldBy: editing.soldBy,
          customAttributes: editing.customAttributes,
        }
      : undefined;
    return (
      <WzDialogContent className="w-[620px]" testId="job-item-dialog">
        <JobItemPopup
          key={current.id}
          product={current}
          isEdit={isEdit}
          mayCost={mayCost}
          bandBinds={bandBinds}
          // A line carried over from Workiz keeps whatever price Workiz
          // recorded — 82% of the historical lines differ from today's
          // catalog price, so the ±15% band must not block saving them.
          bandExempt={sameLine && !priceBandApplies(editing)}
          stockKnown={stockKnown}
          available={availOf(current.id) + stockCredit}
          stockCredit={stockCredit}
          locations={locations}
          techId={techId}
          onLocationChange={setTechId}
          users={users}
          fields={attributes.data ?? []}
          pending={isEdit ? replace.isPending : add.isPending}
          initial={initial}
          onClose={onClose}
          // The unswapped line offers "Change item" (the Workiz flow); a
          // swapped pick backs out to the picker it came from.
          onChangeItem={isEdit ? () => { setPicked(null); setChangingItem(true); } : undefined}
          onSave={(v) => {
            if (editing) {
              replace.mutate({ lineId: editing.lineId, body: v }, { onSuccess: onClose });
            } else {
              add.mutate(v, { onSuccess: onClose });
            }
          }}
        />
      </WzDialogContent>
    );
  }

  return (
    <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-md">
      <DialogHeader>
        <DialogTitle>{pickedGroup ? "Add to job" : "Add a product"}</DialogTitle>
      </DialogHeader>

      {pickedGroup ? (
        <ItemGroupConfirm
          group={pickedGroup}
          submitLabel="Add group"
          pending={addGroup.isPending}
          note={`Parts in ${techName}'s van come out of it; parts it doesn't hold are added to order; services are added directly.`}
          onBack={() => setPickedGroup(null)}
          onSubmit={() =>
            addGroup.mutate({ groupId: pickedGroup.id, sourceTechId: techId }, { onSuccess: onClose })
          }
        />
      ) : (
        <>
          {techIds.length > 1 ? (
            <div className="space-y-1.5">
              <Label className="text-xs">Take from</Label>
              <div className="flex flex-wrap gap-1.5">
                {techIds.map((id) => {
                  const label = nameOf(id) ?? "…";
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
            {!isEdit ? (
              <ItemGroupChoices
                groups={matchedGroups}
                limit={search.trim() ? undefined : 3}
                onPick={setPickedGroup}
              />
            ) : null}
            {catalog.isLoading ? (
              <div className="flex items-center gap-2 py-3 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" /> Loading catalog…</div>
            ) : catalog.isError ? (
              <div className="py-3 text-sm text-destructive">
                <p>Couldn&apos;t load the catalog.</p>
                <p className="text-xs text-muted-foreground">{getApiErrorMessage(catalog.error)}</p>
              </div>
            ) : products.length === 0 ? (
              <p className="py-3 text-sm text-muted-foreground">No products found.</p>
            ) : (
              <>
                {/* The last answer stays, dimmed, while the next search runs. */}
                <div className={cn("space-y-1.5", catalog.isStale && "opacity-70")}>
                  {products.map((p) => {
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
          {stockQuery.isLoading ? (
            <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground"><Loader2 className="size-3 animate-spin" /> Checking {techName}&apos;s van…</p>
          ) : stockQuery.isError ? (
            <p className="text-[11px] text-muted-foreground">Couldn&apos;t load the technician&apos;s stock: {getApiErrorMessage(stockQuery.error)} — you can still try to add; the server will confirm availability.</p>
          ) : null}
        </>
      )}
    </DialogContent>
  );
}
