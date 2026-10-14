"use client";

import { useMemo, useState } from "react";
import { ProductType } from "@bitcrm/types";
import type { ItemAttribute, Product } from "@bitcrm/types";
import { useItemAttributes } from "@/features/inventory/item-attributes/hooks";
import { inputTypeFor } from "@/features/inventory/item-attributes/lib";
import {
  FloatingInput,
  WzButton,
  WzHeader,
  WzSelect,
  WzTextarea,
  WzToggle,
  type WzOption,
} from "@/features/inventory/item-edit/wz";
import { cn } from "@/lib/utils";
import type { AddProductValues } from "../schemas";
import { formatMoney, isPriceInBand, priceRange } from "../lib";
import { amountOf, markupPct, money2, priceFromMarkup } from "../line-item-math";
import { personName } from "../person-name";

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
  /** Whether the viewer is held to the ±15% band at all (see priceBandBinds). */
  bandBinds: boolean;
  /** Imported or item-group line: the band does not judge its recorded price (see priceBandApplies). */
  bandExempt: boolean;
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
  pending: boolean;
  initial?: JobItemInitial;
  onSave: (values: AddProductValues) => void;
  onClose: () => void;
  /** Edit mode: back to the picker to swap the item (our flow; Workiz has none). */
  onChangeItem?: () => void;
}

const NONE = "none";

/** Four boxes in one row sharing their borders, as Workiz draws the Quantity · Price · Markup · Cost row. */
const JOINED = "[&>*+*]:-ml-px";

/**
 * Workiz's "Add job item" card (the job's Items tab → Add item → an item, and
 * the line's own Edit): Item Name; Quantity · Price · Markup % · Cost in one
 * row; Inventory location; Description; Sold by; Taxable Item; the item
 * catalog's custom fields three to a row; Close · Save.
 *
 * Ours on top: a technician is held to the ±15% band (a line under Price), a
 * part the chosen van is short of goes to order (a line under the location),
 * and an edit may change the item ("Change item", left of the buttons).
 */
export function JobItemPopup({
  product,
  isEdit,
  mayCost,
  bandBinds,
  bandExempt,
  stockKnown,
  available,
  stockCredit,
  locations,
  techId,
  onLocationChange,
  users,
  pending,
  initial,
  onSave,
  onClose,
  onChangeItem,
}: JobItemPopupProps) {
  const isService = product.type === ProductType.SERVICE;
  const catalogCost = typeof product.costCompany === "number" ? product.costCompany : 0;
  const storedPrice = initial?.price ?? product.priceClient;

  const [name, setName] = useState(initial?.name ?? product.name);
  const [qty, setQty] = useState(String(initial?.quantity ?? 1));
  const [price, setPrice] = useState(money2(storedPrice));
  const [cost, setCost] = useState(money2(initial?.cost ?? catalogCost));
  const [markup, setMarkup] = useState(() => {
    const m = markupPct(storedPrice, initial?.cost ?? catalogCost);
    return m === null ? "" : money2(m);
  });
  const [location, setLocation] = useState<string>(techId ?? NONE);
  const [description, setDescription] = useState(initial?.description ?? "");
  const [soldBy, setSoldBy] = useState(initial?.soldBy ?? NONE);
  // Absent flags mean taxable — on the line and on the catalog product alike.
  const [taxable, setTaxable] = useState(initial ? initial.taxable !== false : product.taxable !== false);
  const [custom, setCustom] = useState<Record<string, string>>(
    () => initial?.customAttributes ?? product.customAttributes ?? {},
  );

  const attributes = useItemAttributes();
  // The import's orphans (`workiz_attr_<id>`, a value with no field in Workiz)
  // are not fields the office sees — the same rule as the Price Book's columns.
  const fields = useMemo(
    () => (attributes.data ?? []).filter((a) => (a as ItemAttribute & { orphan?: boolean }).orphan !== true),
    [attributes.data],
  );

  const quantity = Math.max(1, Math.floor(Number(qty) || 0) || 1);
  const priceValue = amountOf(price) ?? 0;
  const costValue = amountOf(cost);

  // Two-way: a markup prices the line from its cost; a price or a cost re-marks it.
  const changePrice = (text: string) => {
    setPrice(text);
    const p = amountOf(text);
    const m = p === null || costValue === null ? null : markupPct(p, costValue);
    setMarkup(m === null ? "" : money2(m));
  };
  const changeCost = (text: string) => {
    setCost(text);
    const c = amountOf(text);
    const m = c === null ? null : markupPct(priceValue, c);
    setMarkup(m === null ? "" : money2(m));
  };
  const changeMarkup = (text: string) => {
    setMarkup(text);
    const m = Number(text);
    const p = text.trim() === "" || !Number.isFinite(m) || costValue === null ? null : priceFromMarkup(costValue, m);
    if (p !== null) setPrice(money2(p));
  };
  const changeLocation = (value: string) => {
    setLocation(value);
    onLocationChange?.(value === NONE ? undefined : value);
  };

  const { min, max } = priceRange(product.priceClient);
  // The exemption waives the band for the price Workiz recorded — not for
  // whatever is typed next (the rule the add dialog has always held).
  const exempt = bandBinds && bandExempt && priceValue === storedPrice;
  const inBand = !bandBinds || exempt || isPriceInBand(priceValue, product.priceClient);

  const chosenTech = location === NONE ? undefined : location;
  const chosen = locations.find((l) => l.techId === chosenTech);
  // A stockable part the chosen van is short on — or with no van — is added
  // as a to-order line instead of a van deduction.
  const shortStock = !isService && stockKnown && quantity > available;
  const mustOrder = !isService && (!chosenTech || shortStock);

  const locationOptions = useMemo<WzOption[]>(
    () => [
      ...locations.map((l) => ({ value: l.techId, label: l.available === undefined ? l.label : `${l.label} (${l.available})` })),
      { value: NONE, label: "None" },
    ],
    [locations],
  );
  const userOptions = useMemo<WzOption[]>(
    () => [
      { value: NONE, label: "None" },
      ...users
        .map((u) => ({ value: u.id, label: personName(u) ?? u.id }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    ],
    [users],
  );

  const submit = () => {
    const base = {
      productId: product.id,
      name: name.trim() || product.name,
      sku: product.sku,
      quantity,
      ...(mayCost && costValue !== null ? { costCompany: costValue } : {}),
      priceClient: priceValue,
      taxable,
      description: description.trim() || undefined,
      // "" clears Sold by on an edit; a new line simply has none.
      soldBy: soldBy === NONE ? (isEdit ? "" : undefined) : soldBy,
      customAttributes: custom,
    };
    if (isService) onSave({ ...base, fulfillment: "service" });
    else if (mustOrder) onSave({ ...base, fulfillment: "to_order" });
    else onSave({ ...base, fulfillment: "sourced", sourceTechId: chosenTech });
  };

  const canSave = !pending && inBand && quantity >= 1 && amountOf(price) !== null;

  return (
    <div className="flex max-h-[calc(100dvh-2rem)] min-h-0 flex-col" data-testid="job-item-popup">
      <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-6 pt-6 pb-2">
        <WzHeader title={isEdit ? "Edit job item" : "Add job item"} />

        <FloatingInput label="Item Name" alwaysFloat value={name} onChange={setName} />

        <div className={cn("mt-3 grid", mayCost ? "grid-cols-4" : "grid-cols-2", JOINED)}>
          <FloatingInput label="Quantity" alwaysFloat type="number" min={1} step={1} value={qty} onChange={setQty} />
          <FloatingInput label="Price" alwaysFloat type="number" min={0} step={0.01} value={price} onChange={changePrice} />
          {mayCost ? (
            <>
              <div className="relative min-w-0">
                <FloatingInput
                  label="Markup"
                  alwaysFloat
                  type="number"
                  step={0.01}
                  value={markup}
                  onChange={changeMarkup}
                  inputClassName="pr-7"
                />
                <span aria-hidden className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-[16px] leading-4 text-[#666]">
                  %
                </span>
              </div>
              <FloatingInput label="Cost" alwaysFloat type="number" min={0} step={0.01} value={cost} onChange={changeCost} />
            </>
          ) : null}
        </div>
        {!bandBinds ? null : exempt ? (
          <p className="mt-1 text-[12px] leading-4 text-[#8c8c8c]">
            Imported from Workiz — the ±15% band doesn&apos;t apply. Catalog {formatMoney(product.priceClient)}.
          </p>
        ) : (
          <p className={cn("mt-1 text-[12px] leading-4", inBand ? "text-[#8c8c8c]" : "text-[#f45e44]")}>
            Allowed {formatMoney(min)}–{formatMoney(max)} (±15%)
          </p>
        )}

        {isService ? null : (
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
        )}

        <WzTextarea
          className="mt-3 h-[124px]"
          placeholder="Description"
          value={description}
          onChange={setDescription}
          maxLength={1000}
        />

        <WzSelect
          className="mt-3"
          label="Sold by"
          placeholder="Sold by"
          value={soldBy}
          options={userOptions}
          onChange={setSoldBy}
        />

        <div className="mt-4 flex items-center gap-4">
          <span className="text-[16px] leading-4 text-[#404040]">Taxable Item</span>
          <WzToggle label="Taxable Item" checked={taxable} onChange={setTaxable} />
        </div>

        {fields.length > 0 ? (
          <div className={cn("mt-4 grid grid-cols-3 gap-y-3", "[&>*:not(:nth-child(3n+1))]:-ml-px")} data-testid="job-item-custom-fields">
            {fields.map((field) => (
              <FloatingInput
                key={field.id}
                label={field.name}
                type={inputTypeFor(field)}
                inputMode={field.type === "text" ? undefined : "decimal"}
                value={custom[field.name] ?? ""}
                onChange={(value) => setCustom({ ...custom, [field.name]: value })}
              />
            ))}
          </div>
        ) : null}
      </div>

      <div className="flex flex-none items-center justify-end gap-4 px-6 py-6">
        {isEdit && onChangeItem ? (
          <WzButton variant="tertiary" className="mr-auto" onClick={onChangeItem}>
            Change item
          </WzButton>
        ) : null}
        <WzButton variant="secondary" onClick={onClose}>
          Close
        </WzButton>
        <WzButton loading={pending} disabled={!canSave} onClick={submit}>
          Save
        </WzButton>
      </div>
    </div>
  );
}
