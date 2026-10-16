"use client";

import { useMemo, useState } from "react";
import { ProductType } from "@bitcrm/types";
import type { ItemAttribute, Product } from "@bitcrm/types";
import { WzSelect, type WzOption } from "@/features/inventory/item-edit/wz";
import type { AddProductValues } from "../schemas";
import { ItemCard, type ItemCardInitial, type ItemCardValues } from "./item-card";

/** A van the line can be pulled from: an assigned technician's, with what it holds of the item. */
export interface JobItemLocation {
  techId: string;
  label: string;
  /** What the van holds of the item, when its stock has been read. */
  available?: number;
}

/** What the card opens on when a line is edited (or an item swapped in). */
export interface JobItemInitial {
  name?: string;
  quantity: number;
  price: number;
  cost?: number;
  taxable?: boolean;
  description?: string;
  soldBy?: string;
  customAttributes?: Record<string, string>;
}

export interface JobItemPopupProps {
  product: Product;
  isEdit: boolean;
  /** The viewer holds `financials.view`: the Cost and Markup boxes are theirs. */
  mayCost: boolean;
  stockKnown: boolean;
  /** Units the chosen van can give — its stock plus any credit from the edited line. */
  available: number;
  /** The share of `available` that is the edited line itself, for the copy. */
  stockCredit: number;
  locations: JobItemLocation[];
  /** The van chosen now (undefined = none). */
  techId: string | undefined;
  onLocationChange?: (techId: string | undefined) => void;
  /** Who may be credited with the sale ("Sold by"). */
  users: Array<{ id: string; firstName?: string; lastName?: string; workizName?: string; email?: string }>;
  /** The item catalog's custom fields — read by the flow before the card opens, so it opens whole. */
  fields: ItemAttribute[];
  pending: boolean;
  initial?: JobItemInitial;
  onSave: (values: AddProductValues) => void;
  onClose: () => void;
  /** Edit mode: back to the picker to swap the item (our flow; Workiz has none). */
  onChangeItem?: () => void;
}

const NONE = "none";

/**
 * Workiz's "Add job item" card (the job's Items tab → Add item → an item, and
 * the line's own Edit) — the shared `ItemCard` (the estimate's too) with the
 * job's own part under the price row: Inventory location.
 *
 * Ours on top: a part the chosen van is short of goes to order (a line under
 * the location), and an edit may change the item ("Change item", left of the
 * buttons). The price is anyone's to set — the technician's as the office's,
 * below zero too (owner, 2026-10-15) — and it is the line's alone: the price
 * book is never changed by it.
 */
export function JobItemPopup({
  product,
  isEdit,
  mayCost,
  stockKnown,
  available,
  stockCredit,
  locations,
  techId,
  onLocationChange,
  users,
  fields,
  pending,
  initial,
  onSave,
  onClose,
  onChangeItem,
}: JobItemPopupProps) {
  const isService = product.type === ProductType.SERVICE;
  const catalogCost = typeof product.costCompany === "number" ? product.costCompany : 0;
  const [location, setLocation] = useState<string>(techId ?? NONE);

  const cardInitial = useMemo<ItemCardInitial>(
    () => ({
      name: initial?.name ?? product.name,
      quantity: initial?.quantity ?? 1,
      price: initial?.price ?? product.priceClient,
      cost: initial?.cost ?? catalogCost,
      // Absent flags mean taxable — on the line and on the catalog product alike.
      taxable: initial ? initial.taxable !== false : product.taxable !== false,
      description: initial?.description,
      soldBy: initial?.soldBy,
      customAttributes: initial?.customAttributes ?? product.customAttributes ?? {},
    }),
    // The card reads its opening values once, as a form does.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const changeLocation = (value: string) => {
    setLocation(value);
    onLocationChange?.(value === NONE ? undefined : value);
  };

  const chosenTech = location === NONE ? undefined : location;
  const chosen = locations.find((l) => l.techId === chosenTech);
  // A stockable part the chosen van is short on — or with no van — is added
  // as a to-order line instead of a van deduction.
  const mustOrderFor = (quantity: number) => !isService && (!chosenTech || (stockKnown && quantity > available));

  const locationOptions = useMemo<WzOption[]>(
    () => [
      ...locations.map((l) => ({ value: l.techId, label: l.available === undefined ? l.label : `${l.label} (${l.available})` })),
      { value: NONE, label: "None" },
    ],
    [locations],
  );

  const vanBlock = (quantity: number) => {
    if (isService) return null;
    const mustOrder = mustOrderFor(quantity);
    return (
      <>
        <WzSelect
          className="mt-3"
          label="Inventory location"
          placeholder="Inventory location"
          value={location}
          options={locationOptions}
          onChange={changeLocation}
        />
        {mustOrder ? (
          <p className="mt-1 text-[12px] leading-4 text-[#b7791f]">
            {chosen
              ? `${chosen.label} ${available > 0 ? `only has ${available - stockCredit}` : "doesn’t carry this"}${stockCredit > 0 ? ` (+${stockCredit} on this line)` : ""}`
              : "No van to take this from"}
            . It will be added as an item to order (no stock deducted).
          </p>
        ) : chosen && stockKnown ? (
          <p className="mt-1 text-[12px] leading-4 text-[#8c8c8c]">
            {chosen.label} has {available - stockCredit} in stock
            {stockCredit > 0 ? ` (+${stockCredit} on this line)` : ""}
          </p>
        ) : null}
      </>
    );
  };

  const save = (v: ItemCardValues) => {
    const base = {
      productId: product.id,
      name: v.name || product.name,
      sku: product.sku,
      quantity: v.quantity,
      ...(v.costCompany !== undefined ? { costCompany: v.costCompany } : {}),
      priceClient: v.priceClient,
      taxable: v.taxable,
      description: v.description,
      soldBy: v.soldBy,
      customAttributes: v.customAttributes,
    };
    if (isService) onSave({ ...base, fulfillment: "service" });
    else if (mustOrderFor(v.quantity)) onSave({ ...base, fulfillment: "to_order" });
    else onSave({ ...base, fulfillment: "sourced", sourceTechId: chosenTech });
  };

  return (
    <ItemCard
      title={isEdit ? "Edit job item" : "Add job item"}
      isEdit={isEdit}
      mayCost={mayCost}
      initial={cardInitial}
      users={users}
      fields={fields}
      pending={pending}
      belowPrices={vanBlock}
      onSave={save}
      onClose={onClose}
      onChangeItem={isEdit ? onChangeItem : undefined}
    />
  );
}
