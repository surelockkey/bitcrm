"use client";

import { useMemo, useState, type ReactNode } from "react";
import type { ItemAttribute } from "@bitcrm/types";
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
import { amountOf, markupPct, money2, priceFromMarkup, signedAmountOf } from "../line-item-math";
import { personName } from "../person-name";

/** What the card opens on — the line's own values on an edit, the catalog's on a new line. */
export interface ItemCardInitial {
  name: string;
  quantity: number;
  price: number;
  cost: number;
  taxable: boolean;
  description?: string;
  soldBy?: string;
  customAttributes: Record<string, string>;
  optional?: boolean;
}

/** What the card hands back on Save. */
export interface ItemCardValues {
  name: string;
  quantity: number;
  priceClient: number;
  /** Only from a viewer who may see costs, and only while the Cost box holds a number. */
  costCompany?: number;
  taxable: boolean;
  description?: string;
  /** A user id; "" on an edit set back to None (clears it), absent on a new line with none. */
  soldBy?: string;
  customAttributes: Record<string, string>;
  /** Only when the card offers Optional Item (estimates). */
  optional?: boolean;
}

export interface ItemCardProps {
  title: string;
  isEdit: boolean;
  /** The viewer holds `financials.view`: the Cost and Markup boxes are theirs. */
  mayCost: boolean;
  initial: ItemCardInitial;
  /** Who may be credited with the sale ("Sold by"). */
  users: Array<{ id: string; firstName?: string; lastName?: string; workizName?: string; email?: string }>;
  /** The item catalog's custom fields — read before the card opens, so it opens whole. */
  fields: ItemAttribute[];
  pending: boolean;
  /** Workiz's "Optional Item" switch under Taxable Item — an estimate's line only. */
  showOptional?: boolean;
  /** What goes under the Quantity · Price row (the job's van; an estimate's catalog note), given the quantity typed. */
  belowPrices?: (quantity: number) => ReactNode;
  onSave: (values: ItemCardValues) => void;
  onClose: () => void;
  /** Back to the picker to swap the item (our flow; Workiz has none). */
  onChangeItem?: () => void;
}

const NONE = "none";

/** Four boxes in one row sharing their borders, as Workiz draws the Quantity · Price · Markup · Cost row. */
const JOINED = "[&>*+*]:-ml-px";

/**
 * Workiz's item card, one for the job and the estimate alike (the job's Items
 * tab → Add item → an item, a line's own Edit, the estimate's Items):
 * Item Name; Quantity · Price · Markup % · Cost in one row; what the page puts
 * under it (the job's Inventory location); Description; Sold by; Taxable Item;
 * Optional Item on an estimate; the item catalog's custom fields three to a
 * row; Close · Save.
 *
 * The price is anyone's to set — below zero too (owner, 2026-10-15) — and it
 * is the line's alone: the price book is never changed by it.
 */
export function ItemCard({
  title,
  isEdit,
  mayCost,
  initial,
  users,
  fields: allFields,
  pending,
  showOptional = false,
  belowPrices,
  onSave,
  onClose,
  onChangeItem,
}: ItemCardProps) {
  const [name, setName] = useState(initial.name);
  const [qty, setQty] = useState(String(initial.quantity));
  const [price, setPrice] = useState(money2(initial.price));
  const [cost, setCost] = useState(money2(initial.cost));
  const [markup, setMarkup] = useState(() => {
    const m = markupPct(initial.price, initial.cost);
    return m === null ? "" : money2(m);
  });
  const [description, setDescription] = useState(initial.description ?? "");
  const [soldBy, setSoldBy] = useState(initial.soldBy || NONE);
  const [taxable, setTaxable] = useState(initial.taxable);
  const [optional, setOptional] = useState(initial.optional === true);
  const [custom, setCustom] = useState<Record<string, string>>(() => initial.customAttributes);

  // The import's orphans (`workiz_attr_<id>`, a value with no field in Workiz)
  // are not fields the office sees — the same rule as the Price Book's columns.
  const fields = useMemo(
    () => allFields.filter((a) => (a as ItemAttribute & { orphan?: boolean }).orphan !== true),
    [allFields],
  );

  const quantity = Math.max(1, Math.floor(Number(qty) || 0) || 1);
  // The price may go below zero (a credit line, as Workiz allows); a cost never does.
  const priceValue = signedAmountOf(price) ?? 0;
  const costValue = amountOf(cost);

  // Two-way: a markup prices the line from its cost; a price or a cost re-marks it.
  const changePrice = (text: string) => {
    setPrice(text);
    const p = signedAmountOf(text);
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

  const userOptions = useMemo<WzOption[]>(
    () => [
      { value: NONE, label: "None" },
      ...users
        .map((u) => ({ value: u.id, label: personName(u) ?? u.id }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    ],
    [users],
  );

  const submit = () =>
    onSave({
      name: name.trim() || initial.name,
      quantity,
      priceClient: priceValue,
      ...(mayCost && costValue !== null ? { costCompany: costValue } : {}),
      taxable,
      description: description.trim() || undefined,
      // "" clears Sold by on an edit; a new line simply has none.
      soldBy: soldBy === NONE ? (isEdit ? "" : undefined) : soldBy,
      customAttributes: custom,
      ...(showOptional ? { optional } : {}),
    });

  const canSave = !pending && quantity >= 1 && signedAmountOf(price) !== null;

  return (
    <div className="flex max-h-[calc(100dvh-2rem)] min-h-0 flex-col" data-testid="job-item-popup">
      <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-6 pt-6 pb-2">
        <WzHeader title={title} />

        <FloatingInput label="Item Name" alwaysFloat value={name} onChange={setName} />

        <div className={cn("mt-3 grid", mayCost ? "grid-cols-4" : "grid-cols-2", JOINED)}>
          <FloatingInput label="Quantity" alwaysFloat type="number" min={1} step={1} value={qty} onChange={setQty} />
          <FloatingInput label="Price" alwaysFloat type="number" step={0.01} value={price} onChange={changePrice} />
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
        {belowPrices?.(quantity)}

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
        {showOptional ? (
          <div className="mt-4 flex items-center gap-4">
            <span className="text-[16px] leading-4 text-[#404040]">Optional Item</span>
            <WzToggle label="Optional Item" checked={optional} onChange={setOptional} />
          </div>
        ) : null}

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
        {onChangeItem ? (
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
