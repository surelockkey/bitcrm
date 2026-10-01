"use client";

import { useMemo } from "react";
import type { BillingLine } from "@bitcrm/types";
import { DocumentItemsTable, type DocumentLineItem } from "@/features/billing/components/document-items-table";
import {
  useAddInvoiceItem,
  useDeleteInvoiceItem,
  useReorderInvoiceItems,
  useSetInvoiceItemTaxable,
  useUpdateInvoiceItem,
} from "../hooks";

/** A client invoice's own lines come back as `BillingLine`s with a position. */
export function toLineItems(items: BillingLine[]): DocumentLineItem[] {
  return items.map((l, index) => ({
    lineId: l.lineId,
    position: l.position ?? index,
    productId: l.productId,
    productType: l.productType,
    name: l.name,
    sku: l.sku,
    description: l.description,
    quantity: l.quantity,
    priceClient: l.priceClient,
    costCompany: l.costCompany ?? 0,
    costForTech: l.costForTech ?? 0,
    taxable: l.taxable !== false,
  }));
}

/** The lines of a CLIENT invoice (no job) — a job invoice's lines are the job's items. */
export function InvoiceItemsTable({
  invoiceId,
  items,
  canEdit,
}: {
  invoiceId: string;
  items: BillingLine[];
  canEdit: boolean;
}) {
  const add = useAddInvoiceItem(invoiceId);
  const update = useUpdateInvoiceItem(invoiceId);
  const remove = useDeleteInvoiceItem(invoiceId);
  const reorder = useReorderInvoiceItems(invoiceId);
  const setTaxable = useSetInvoiceItemTaxable(invoiceId);
  const lines = useMemo(() => toLineItems(items), [items]);

  return (
    <DocumentItemsTable
      items={lines}
      canEdit={canEdit}
      emptyText="No items on this invoice yet."
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
