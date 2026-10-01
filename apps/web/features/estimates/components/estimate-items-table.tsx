"use client";

import type { EstimateItem } from "@bitcrm/types";
import { DocumentItemsTable } from "@/features/billing/components/document-items-table";
import {
  useAddEstimateItem,
  useDeleteEstimateItem,
  useReorderEstimateItems,
  useSetEstimateItemTaxable,
  useUpdateEstimateItem,
} from "../hooks";

/** An estimate's lines. `dealId` is the job to refresh — none for a client estimate. */
export function EstimateItemsTable({
  estimateId,
  dealId,
  items,
  canEdit,
}: {
  estimateId: string;
  dealId?: string;
  items: EstimateItem[];
  canEdit: boolean;
}) {
  const add = useAddEstimateItem(estimateId, dealId);
  const update = useUpdateEstimateItem(estimateId, dealId);
  const remove = useDeleteEstimateItem(estimateId, dealId);
  const reorder = useReorderEstimateItems(estimateId, dealId);
  const setTaxable = useSetEstimateItemTaxable(estimateId, dealId);

  return (
    <DocumentItemsTable
      items={items}
      canEdit={canEdit}
      emptyText="No items on this estimate yet."
      pending={{
        add: add.isPending,
        update: update.isPending,
        removingLineId: remove.isPending ? remove.variables : undefined,
      }}
      onAdd={(body, done) => add.mutate(body, { onSuccess: done })}
      onUpdate={(lineId, body, done) => update.mutate({ lineId, body }, { onSuccess: done })}
      onRemove={(lineId) => remove.mutate(lineId)}
      onReorder={(lineIds) => reorder.mutate(lineIds)}
      onTaxable={(lineId, taxable) => setTaxable.mutate({ lineId, taxable })}
    />
  );
}
