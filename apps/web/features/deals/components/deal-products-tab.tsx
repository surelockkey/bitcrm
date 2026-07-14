"use client";

import { useState } from "react";
import { Loader2, Plus, X } from "lucide-react";
import type { Deal } from "@bitcrm/types";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useDealProducts, useRemoveProduct } from "../hooks";
import { dealTotal, formatMoney } from "../lib";
import { AddProductDialog } from "./add-product-dialog";

export function DealProductsTab({ deal, canEdit }: { deal: Deal; canEdit: boolean }) {
  const { data: products, isLoading } = useDealProducts(deal.id);
  const remove = useRemoveProduct(deal.id);
  const [adding, setAdding] = useState(false);

  if (isLoading) return <Skeleton className="h-40 w-full" />;
  const items = products ?? [];
  const total = dealTotal(items);
  const noTech = !deal.assignedTechId;

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
                    <div className="font-medium">{p.name}</div>
                    <div className="font-mono text-[11px] text-muted-foreground">{p.sku} · tech {formatMoney(p.costForTech)}</div>
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
            <Button variant="outline" size="sm" className="gap-1.5" disabled={noTech} onClick={() => setAdding(true)}>
              <Plus className="size-3.5" /> Add product
            </Button>
            {noTech ? <span className="text-[11px] text-muted-foreground">Assign a technician first — products come from their container.</span> : null}
          </div>
        ) : <span />}
        <span className="font-mono text-sm font-semibold tabular-nums">Total {formatMoney(total)}</span>
      </div>

      <AddProductDialog dealId={deal.id} open={adding} onOpenChange={setAdding} />
    </div>
  );
}
