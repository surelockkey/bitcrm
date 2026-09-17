"use client";

import { useMemo, useState } from "react";
import { Check, Loader2, Plus, ShieldCheck, X } from "lucide-react";
import { calculateDocumentTotals } from "@bitcrm/types";
import type { Deal, DealProduct } from "@bitcrm/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { useContact } from "@/features/clients/hooks";
import { DocumentSummaryPanel } from "@/features/billing/components/document-summary-panel";
import {
  useDealProducts,
  useDealTotals,
  useMarkProductOrdered,
  useRemoveProduct,
  useResetDealTax,
  useSetDealDiscount,
  useSetDealTax,
  useSetProductTaxable,
} from "../hooks";
import { formatMoney } from "../lib";
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

export function DealProductsTab({
  deal,
  canEdit,
  showPayments = false,
}: {
  deal: Deal;
  canEdit: boolean;
  /** Add Paid / Balance due to the summary (the Invoice tab reuses this view). */
  showPayments?: boolean;
}) {
  const { data: products, isLoading } = useDealProducts(deal.id);
  const totalsQuery = useDealTotals(deal.id);
  const remove = useRemoveProduct(deal.id);
  const markOrdered = useMarkProductOrdered(deal.id);
  const setTaxable = useSetProductTaxable(deal.id);
  const setTax = useSetDealTax(deal.id);
  const resetTax = useResetDealTax(deal.id);
  const setDiscount = useSetDealDiscount(deal.id);
  const exempt = deal.taxSource === "exempt";
  const { data: contact } = useContact(exempt ? deal.contactId : "");
  const [adding, setAdding] = useState(false);
  // Clicking a row edits that line in the same dialog (change qty/price or
  // swap the item for another catalog product).
  const [editing, setEditing] = useState<DealProduct | null>(null);

  const items = useMemo(() => products ?? [], [products]);
  // Server totals are authoritative; until they arrive (or while a line edit
  // is refetching) the same shared formula runs on the local items.
  const localTotals = useMemo(
    () =>
      calculateDocumentTotals({
        lines: items,
        taxRatePercent: deal.taxRatePercent,
        discount: deal.discount,
      }),
    [items, deal.taxRatePercent, deal.discount],
  );
  const totals = totalsQuery.data && !totalsQuery.isFetching ? totalsQuery.data : localTotals;

  if (isLoading) return <Skeleton className="h-40 w-full" />;

  return (
    <div className="space-y-3">
      {exempt ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Badge variant="outline" className="gap-1 border-emerald-500/40 font-normal text-emerald-700 dark:text-emerald-400">
            <ShieldCheck /> Tax exempt
          </Badge>
          {contact?.taxExemptReason ? <span>{contact.taxExemptReason}</span> : null}
        </div>
      ) : null}
      {items.length === 0 ? (
        <div className="rounded-lg border border-dashed py-10 text-center text-sm text-muted-foreground">
          No products on this job yet.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full min-w-[28rem] text-sm">
            <thead>
              <tr className="border-b bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-3 py-2 text-left font-semibold">Item</th>
                <th className="px-3 py-2 text-right font-semibold">Qty</th>
                <th className="px-3 py-2 text-right font-semibold">Client</th>
                <th className="px-3 py-2 text-right font-semibold">Line</th>
                <th className="px-2 py-2 text-center font-semibold">Taxable</th>
                {canEdit ? <th className="w-8" /> : null}
              </tr>
            </thead>
            <tbody>
              {items.map((p) => (
                <tr
                  key={p.productId}
                  className={cn("border-b last:border-0", canEdit && "cursor-pointer hover:bg-accent/30")}
                  onClick={canEdit ? () => setEditing(p) : undefined}
                >
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      {canEdit ? (
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); setEditing(p); }}
                          aria-label={`Edit ${p.name}`}
                          className="font-medium hover:underline"
                        >
                          {p.name}
                        </button>
                      ) : (
                        <span className="font-medium">{p.name}</span>
                      )}
                      <FulfillmentBadge product={p} />
                    </div>
                    {p.description ? (
                      <p className="mt-0.5 line-clamp-2 text-xs whitespace-pre-line text-muted-foreground">{p.description}</p>
                    ) : null}
                    <div className="font-mono text-[11px] text-muted-foreground">{p.sku} · tech {formatMoney(p.costForTech)}</div>
                    {canEdit && (p.fulfillment ?? "sourced") === "to_order" ? (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          markOrdered.mutate({ productId: p.productId, ordered: !p.orderedAt });
                        }}
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
                  <td className="px-2 py-2 text-center" onClick={(e) => e.stopPropagation()}>
                    <Checkbox
                      checked={p.taxable !== false}
                      disabled={!canEdit}
                      onCheckedChange={(v) =>
                        setTaxable.mutate({ productId: p.productId, taxable: v === true })
                      }
                      aria-label={`${p.name} is taxable`}
                    />
                  </td>
                  {canEdit ? (
                    <td className="px-2 py-2 text-right">
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); remove.mutate(p.productId); }}
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

      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        {canEdit ? (
          <div className="flex flex-col items-start gap-1">
            <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setAdding(true)}>
              <Plus className="size-3.5" /> Add item
            </Button>
          </div>
        ) : <span />}
        <DocumentSummaryPanel
          totals={totals}
          taxRateId={deal.taxRateId}
          taxRateName={deal.taxRateName}
          taxSource={deal.taxSource}
          discount={deal.discount}
          canEdit={canEdit}
          pending={setTax.isPending || resetTax.isPending || setDiscount.isPending}
          onTaxChange={(taxRateId) => setTax.mutate(taxRateId)}
          onResetTaxAuto={() => resetTax.mutate()}
          onDiscountChange={(d) => setDiscount.mutate(d)}
          exemptLabel={contact?.taxExemptReason}
          showPayments={showPayments}
        />
      </div>

      <AddProductDialog
        dealId={deal.id}
        techIds={deal.assignedTechIds}
        open={adding || !!editing}
        editing={editing ?? undefined}
        onOpenChange={(v) => {
          if (!v) {
            setAdding(false);
            setEditing(null);
          } else {
            setAdding(true);
          }
        }}
      />
    </div>
  );
}
