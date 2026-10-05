"use client";

import type { ReactNode } from "react";
import type { EstimateItem } from "@bitcrm/types";
import { DocumentItemsTable } from "@/features/billing/components/document-items-table";
import { usePermissions } from "@/features/auth/use-permissions";
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
  toolbar,
  addClassName,
}: {
  estimateId: string;
  dealId?: string;
  items: EstimateItem[];
  canEdit: boolean;
  /** Buttons beside "Add item" (Price book, Sync to Job / Create new job). */
  toolbar?: ReactNode;
  /** The estimate page's look for "Add item". */
  addClassName?: string;
}) {
  const { can } = usePermissions();
  const add = useAddEstimateItem(estimateId, dealId);
  const update = useUpdateEstimateItem(estimateId, dealId);
  const remove = useDeleteEstimateItem(estimateId, dealId);
  const reorder = useReorderEstimateItems(estimateId, dealId);
  const setTaxable = useSetEstimateItemTaxable(estimateId, dealId);

  return (
    <DocumentItemsTable
      items={items}
      canEdit={canEdit}
      showCost={can("financials", "view")}
      emptyText="No items on this estimate yet."
      toolbar={toolbar}
      addClassName={addClassName}
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
