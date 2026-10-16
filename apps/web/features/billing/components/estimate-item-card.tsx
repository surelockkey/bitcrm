"use client";

import { useMemo } from "react";
import type { ItemAttribute, Product } from "@bitcrm/types";
import { ItemCard, type ItemCardInitial, type ItemCardValues } from "@/features/deals/components/item-card";
import type { EstimateItemBody } from "@/features/estimates/schemas";
import type { PickerLine } from "./product-picker-dialog";

export interface EstimateItemCardProps {
  /** The catalog item: `null` when an edited line's item has left the catalog. */
  product: Product | null;
  /** The line being edited; absent on a new line. */
  line?: PickerLine;
  /** The viewer holds `financials.view`: the Cost and Markup boxes are theirs. */
  mayCost: boolean;
  users: Array<{ id: string; firstName?: string; lastName?: string; workizName?: string; email?: string }>;
  fields: ItemAttribute[];
  pending: boolean;
  onSave: (body: EstimateItemBody) => void;
  onClose: () => void;
  onChangeItem?: () => void;
}

/**
 * Workiz's estimate item card ("Add estimate items" / "Edit estimate items"):
 * the job's card (`ItemCard`) with Optional Item and without the van — an
 * estimate reserves nothing until it is synced to the job.
 *
 * Workiz freezes the cost on the line, so an edit opens on the line's own
 * costs and the catalog's never overwrite them; a viewer who cannot see
 * costs keeps the line's (or the catalog's, on a new line).
 */
export function EstimateItemCard({
  product,
  line,
  mayCost,
  users,
  fields,
  pending,
  onSave,
  onClose,
  onChangeItem,
}: EstimateItemCardProps) {
  const baseCost = line ? line.costCompany : (product?.costCompany ?? 0);
  const costForTech = line ? line.costForTech : (product?.costTech ?? 0);

  const initial = useMemo<ItemCardInitial>(
    () =>
      line
        ? {
            name: line.name,
            quantity: line.quantity,
            price: line.priceClient,
            cost: line.costCompany,
            taxable: line.taxable,
            description: line.description,
            soldBy: line.soldBy,
            customAttributes: line.customAttributes ?? {},
            optional: line.optional === true,
          }
        : {
            name: product?.name ?? "",
            quantity: 1,
            price: product?.priceClient ?? 0,
            cost: product?.costCompany ?? 0,
            taxable: product?.taxable !== false,
            customAttributes: product?.customAttributes ?? {},
            optional: false,
          },
    // The card reads its opening values once, as a form does.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const save = (v: ItemCardValues) =>
    onSave({
      productId: product?.id ?? line?.productId ?? "",
      productType: product?.type ?? line?.productType,
      name: v.name,
      sku: product?.sku ?? line?.sku ?? "",
      description: v.description,
      quantity: v.quantity,
      priceClient: v.priceClient,
      costCompany: mayCost ? (v.costCompany ?? baseCost) : baseCost,
      costForTech,
      taxable: v.taxable,
      soldBy: v.soldBy,
      customAttributes: v.customAttributes,
      optional: v.optional === true,
    });

  return (
    <ItemCard
      title={line ? "Edit estimate items" : "Add estimate items"}
      isEdit={!!line}
      mayCost={mayCost}
      initial={initial}
      users={users}
      fields={fields}
      pending={pending}
      showOptional
      belowPrices={
        product === null
          ? () => <p className="mt-1 text-[12px] leading-4 text-[#b7791f]">This item is no longer in the catalog.</p>
          : undefined
      }
      onSave={save}
      onClose={onClose}
      onChangeItem={onChangeItem}
    />
  );
}
