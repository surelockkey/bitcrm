"use client";

import { useState } from "react";
import { Check, Loader2, Plus, X } from "lucide-react";
import type { Deal, DealProduct } from "@bitcrm/types";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { useDealProducts, useRemoveProduct, useMarkProductOrdered } from "../hooks";
import { dealTotal, formatMoney } from "../lib";
import { AddProductDialog } from "./add-product-dialog";

function FulfillmentBadge({ product }: { product: DealProduct }) {
  const f = product.fulfillment ?? "sourced";
  if (f === "service") {
    return (
      <span className="rounded-full bg-sky-100 px-1.5 py-0.5 text-[10px] font-semibold text-sky-700 dark:bg-sky-950/60 dark:text-sky-300">
        Service
      </span>
    );
  }
  if (f === "to_order") {
    return product.orderedAt ? (
      <span className="rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300">
        Ordered
      </span>
    ) : (
      <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700 dark:bg-amber-950/60 dark:text-amber-300">
        To order
      </span>
    );
  }
  return null; // `sourced` is the default — no badge needed.
}

export function DealProductsTab({ deal, canEdit }: { deal: Deal; canEdit: boolean }) {
  const { data: products, isLoading } = useDealProducts(deal.id);
  const remove = useRemoveProduct(deal.id);
  const markOrdered = useMarkProductOrdered(deal.id);
  const [adding, setAdding] = useState(false);

  if (isLoading) return <Skeleton className="h-40 w-full" />;
  const items = products ?? [];
  const total = dealTotal(items);

  return (
    <div className="space-y-3">
      {items.length === 0 ? (
        <div className="rounded-lg border border-dashed py-10 text-center text-sm text-muted-foreground">
          No products on this deal yet.
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-3 py-2 text-left font-semibold">Item</th>
                <th className="px-3 py-2 text-right font-semibold">Qty</th>
                <th className="px-3 py-2 text-right font-semibold">Client</th>
                <th className="px-3 py-2 text-right font-semibold">Line</th>
                {canEdit ? <th className="w-8" /> : null}
              </tr>
            </thead>
            <tbody>
              {items.map((p) => (
                <tr key={p.productId} className="border-b last:border-0">
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{p.name}</span>
                      <FulfillmentBadge product={p} />
                    </div>
                    <div className="font-mono text-[11px] text-muted-foreground">{p.sku} · tech {formatMoney(p.costForTech)}</div>
                    {canEdit && (p.fulfillment ?? "sourced") === "to_order" ? (
                      <button
                        type="button"
                        onClick={() =>
                          markOrdered.mutate({ productId: p.productId, ordered: !p.orderedAt })
                        }
                        disabled={markOrdered.isPending}
                        className={cn(
                          "mt-1 inline-flex items-center gap-1 text-[11px] font-medium",
                          p.orderedAt ? "text-muted-foreground hover:text-foreground" : "text-amber-700 hover:text-amber-800 dark:text-amber-400",
                        )}
                      >
                        <Check className="size-3" />
                        {p.orderedAt ? "Mark not ordered" : "Mark ordered"}
                      </button>
                    ) : null}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{p.quantity}</td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums">{formatMoney(p.priceClient)}</td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums">{formatMoney(p.priceClient * p.quantity)}</td>
                  {canEdit ? (
                    <td className="px-2 py-2 text-right">
                      <button
                        type="button"
                        onClick={() => remove.mutate(p.productId)}
                        disabled={remove.isPending}
                        className="text-muted-foreground hover:text-destructive"
                        aria-label={`Remove ${p.name}`}
                      >
                        {remove.isPending ? <Loader2 className="size-4 animate-spin" /> : <X className="size-4" />}
                      </button>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex items-center justify-between">
        {canEdit ? (
          <div className="flex flex-col items-start gap-1">
            <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setAdding(true)}>
              <Plus className="size-3.5" /> Add item
            </Button>
          </div>
        ) : <span />}
        <span className="font-mono text-sm font-semibold tabular-nums">Total {formatMoney(total)}</span>
      </div>

      <AddProductDialog dealId={deal.id} techIds={deal.assignedTechIds} open={adding} onOpenChange={setAdding} />
    </div>
  );
}
