"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { BookOpen, Check, Loader2, Plus, ShieldCheck, Trash2 } from "lucide-react";
import { calculateDocumentTotals } from "@bitcrm/types";
import type { Deal, DealProduct, PaymentSummary } from "@bitcrm/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { useContact } from "@/features/clients/hooks";
import { DocumentSummaryPanel } from "@/features/billing/components/document-summary-panel";
import { applyAmountPaid } from "@/features/payments/lib";
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
import { ItemsArt } from "./job-empty-art";
import { JobItemsTotals } from "./job-items-totals";
import { PILL_OUTLINE, PILL_YELLOW } from "./job-pills";

function FulfillmentBadge({ product }: { product: DealProduct }) {
  const f = product.fulfillment ?? "sourced";
  if (f === "imported") {
    // Carried over from Workiz: it never moved BitCRM stock, and its price is
    // whatever Workiz recorded (so the ±15% band leaves it alone).
    return (
      <span className="rounded-chip bg-muted px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">
        Imported
      </span>
    );
  }
  if (f === "service") {
    return (
      <span className="rounded-chip bg-sky-100 px-1.5 py-0.5 text-[10px] font-semibold text-sky-700 dark:bg-sky-950/60 dark:text-sky-300">
        Service
      </span>
    );
  }
  if (f === "to_order") {
    return product.orderedAt ? (
      <span className="rounded-chip bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300">
        Ordered
      </span>
    ) : (
      <span className="rounded-chip bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700 dark:bg-amber-950/60 dark:text-amber-300">
        To order
      </span>
    );
  }
  return null; // `sourced` is the default — no badge needed.
}

/**
 * Workiz's item tag (job_b items: "SERVICE"): 10px capitals in an outlined
 * lozenge under the name. Ours names how the line is fulfilled, each in a
 * Workiz status colour; a van-stock line (the default) carries none.
 */
const WZ_TAG: Record<string, { label: string; color: string } | undefined> = {
  service: { label: "Service", color: "#6aa8ee" },
  imported: { label: "Imported", color: "#9ea6aa" },
  to_order: { label: "To order", color: "#fbab33" },
  ordered: { label: "Ordered", color: "#3acf7d" },
};

function WorkizItemTag({ product }: { product: DealProduct }) {
  const f = product.fulfillment ?? "sourced";
  const tag = WZ_TAG[f === "to_order" && product.orderedAt ? "ordered" : f];
  if (!tag) return null;
  return (
    <span
      className="inline-flex h-[18px] items-center rounded-[10px] border px-2 text-[10px] leading-4 uppercase"
      style={{ color: tag.color, borderColor: tag.color }}
    >
      {tag.label}
    </span>
  );
}

const th = "px-3 py-2.5 text-left text-[13px] font-semibold";
const td = "px-3 py-3 align-top";
const cell = cn(td, "border-b border-l border-dashed");

/** Workiz's grid (job_b_tab_items): 47px bold heads, dotted #cfcfcf rules, 15/10/15/15 padding. */
const wzTh = "h-[47px] border-r border-b border-dotted border-[#cfcfcf] py-[15px] pr-2.5 pl-[15px] text-left text-[14px] leading-4 font-bold";
const wzTd = "border-r border-b border-r-[#cfcfcf] border-b-[#e6e6e6] border-dotted [border-bottom-style:solid] py-[15px] pr-2.5 pl-[15px] align-top text-[14px] leading-4";

/** What the job grid keeps off its 85px row: the description, then "SKU · tech $x". */
function itemTooltip(p: DealProduct): string {
  return [p.description, `${p.sku} · tech ${formatMoney(p.costForTech)}`].filter(Boolean).join("\n");
}

export function DealProductsTab({
  deal,
  canEdit,
  showPayments = false,
  paymentSummary,
  variant = "shared",
  showCost = false,
  balance,
  due,
}: {
  deal: Deal;
  canEdit: boolean;
  /** Add Paid / Balance due to the summary (the Invoice tab reuses this view). */
  showPayments?: boolean;
  /**
   * The invoice's payment ledger, when the Invoice tab has it. It is the
   * authority on what has been collected — the job snapshot can lag a payment
   * by a beat.
   */
  paymentSummary?: PaymentSummary;
  /**
   * `job`: the job page's Items tab in Workiz's dress — "Job Items", the
   * ruled grid and the grey-box totals. `shared` (the Invoice tab) keeps the
   * summary card.
   */
  variant?: "shared" | "job";
  /** Job variant: the Cost column and "Job costing" (financials.view). */
  showCost?: boolean;
  /** Job variant: what is still owed (the ledger's balance, else the job row's). */
  balance?: number;
  /** Job variant: the invoice's due date, already formatted. */
  due?: string;
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
  const snapshot = totalsQuery.data && !totalsQuery.isFetching ? totalsQuery.data : localTotals;
  // The ledger, when the Invoice tab has it, restates Paid / Balance due.
  const totals = paymentSummary ? applyAmountPaid(snapshot, paymentSummary.settled) : snapshot;

  if (isLoading) return <Skeleton className="h-40 w-full" />;

  const dialog = (
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
  );

  const markOrderedButton = (p: DealProduct) =>
    canEdit && (p.fulfillment ?? "sourced") === "to_order" ? (
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          markOrdered.mutate({ lineId: p.lineId, ordered: !p.orderedAt });
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
    ) : null;

  const taxableCheckbox = (p: DealProduct, className?: string) => (
    <label className={cn("inline-flex items-center gap-2", className)}>
      <Checkbox
        checked={p.taxable !== false}
        disabled={!canEdit}
        onCheckedChange={(v) => setTaxable.mutate({ lineId: p.lineId, taxable: v === true })}
        aria-label={`${p.name} is taxable`}
      />
      <span>{p.taxable !== false ? "Yes" : "No"}</span>
    </label>
  );

  if (variant === "job") {
    const withActions = canEdit && items.length > 0;
    // Workiz's column widths: 56 + 579 + 5 × 126 on an empty grid; with
    // rows 71 + 287 + 160 × 5 + 106 (audit_pixels T1/T2). The first column
    // is Workiz's drag-handle column — job items do not reorder here, so it
    // holds no handle, only its width.
    const num = items.length > 0 ? "w-[160px]" : "w-[126px]";
    return (
      <section aria-labelledby="job-items-heading" className="text-[#404040]">
        <div className="flex items-end justify-between border-b border-[#cad3d6] pt-1 pb-[14px]">
          <h2 id="job-items-heading" className="text-[18px] leading-[22px] font-semibold">
            Job Items
          </h2>
        </div>

        <div className="mt-[15px] overflow-x-auto">
          <table className="w-full min-w-[52rem] table-fixed border-separate border-spacing-0">
            <thead>
              <tr>
                <th aria-hidden className={cn(wzTh, items.length > 0 ? "w-[71px]" : "w-[56px]")} />
                <th className={wzTh}>Item</th>
                <th className={cn(wzTh, num)}>Quantity</th>
                <th className={cn(wzTh, num)}>Price</th>
                {showCost ? <th className={cn(wzTh, num)}>Cost</th> : null}
                <th className={cn(wzTh, num)}>Amount</th>
                <th className={cn(wzTh, num)}>Taxable</th>
                {withActions ? <th className={cn(wzTh, "w-[106px] border-r-0")}>Actions</th> : null}
              </tr>
            </thead>
            {items.length > 0 ? (
              <tbody>
                {items.map((p) => (
                  <tr
                    key={p.lineId}
                    className={cn(canEdit && "cursor-pointer hover:bg-[#f8f8f8]")}
                    onClick={canEdit ? () => setEditing(p) : undefined}
                  >
                    <td aria-hidden className={wzTd} />
                    <td className={cn(wzTd, "h-[85px]")}>
                      {canEdit ? (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setEditing(p);
                          }}
                          aria-label={`Edit ${p.name}`}
                          title={itemTooltip(p)}
                          className="max-w-full truncate text-left hover:underline"
                        >
                          {p.name}
                        </button>
                      ) : (
                        <span title={itemTooltip(p)} className="block truncate">
                          {p.name}
                        </span>
                      )}
                      {/* Workiz's row: the name and the type chip, nothing more —
                          the description and SKU wait in the name's tooltip. */}
                      <div className="mt-[15px] flex flex-wrap items-center gap-2">
                        <WorkizItemTag product={p} />
                      </div>
                      {markOrderedButton(p)}
                    </td>
                    <td className={cn(wzTd, "tabular-nums")}>{p.quantity.toFixed(2)}</td>
                    <td className={cn(wzTd, "tabular-nums")}>{formatMoney(p.priceClient)}</td>
                    {showCost ? <td className={cn(wzTd, "tabular-nums")}>{formatMoney(p.costCompany)}</td> : null}
                    <td className={cn(wzTd, "tabular-nums")}>{formatMoney(p.priceClient * p.quantity)}</td>
                    {/* A word, as Workiz writes it; it is changed in the item's window. */}
                    <td className={wzTd}>{p.taxable !== false ? "Yes" : "No"}</td>
                    {withActions ? (
                      <td className={cn(wzTd, "border-r-0")}>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            remove.mutate(p.lineId);
                          }}
                          disabled={remove.isPending}
                          className="grid size-8 place-items-center rounded-[8px] text-foreground hover:bg-[#f3f6f7] hover:text-destructive"
                          aria-label={`Remove ${p.name}`}
                        >
                          {remove.isPending ? <Loader2 className="size-5 animate-spin" /> : <Trash2 className="size-5" strokeWidth={1.25} />}
                        </button>
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            ) : null}
          </table>
        </div>

        {items.length === 0 ? (
          // Workiz's empty grid: art and "Add items" in a 232px band.
          <div className="flex h-[232px] flex-col items-center justify-end gap-1 border-b border-[#e6e6e6] pb-[13px]">
            <ItemsArt />
            {canEdit ? (
              <button type="button" onClick={() => setAdding(true)} className="text-[16px] leading-[19px] text-[#404040] hover:underline">
                Add items
              </button>
            ) : (
              <span className="text-[16px] leading-[19px]">No items</span>
            )}
          </div>
        ) : null}

        {canEdit ? (
          <div className="mt-5 flex flex-wrap items-center gap-2.5">
            <button type="button" className={PILL_YELLOW} onClick={() => setAdding(true)}>
              <Plus /> Add item
            </button>
            <Link href="/inventory/items" className={PILL_OUTLINE}>
              <BookOpen strokeWidth={1.5} /> Price book
            </Link>
          </div>
        ) : null}

        <JobItemsTotals
          totals={totals}
          balance={balance ?? Math.max(0, totals.total - totals.amountPaid)}
          due={due}
          cost={showCost ? deal.totals?.cost : undefined}
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
        />

        {dialog}
      </section>
    );
  }

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
        <div className="overflow-x-auto">
          <table className="w-full min-w-[36rem] border-separate border-spacing-0 text-sm">
            <thead>
              <tr>
                <th className={cn(th, "border-b border-dashed")}>Item</th>
                <th className={cn(th, "w-28 border-b border-l border-dashed")}>Quantity</th>
                <th className={cn(th, "w-32 border-b border-l border-dashed")}>Price</th>
                <th className={cn(th, "w-32 border-b border-l border-dashed")}>Amount</th>
                <th className={cn(th, "w-24 border-b border-l border-dashed")}>Taxable</th>
                {canEdit ? <th className="w-12 border-b border-l border-dashed" aria-label="Remove" /> : null}
              </tr>
            </thead>
            <tbody>
              {items.map((p) => (
                <tr
                  key={p.lineId}
                  className={cn(canEdit && "cursor-pointer hover:bg-accent/30")}
                  onClick={canEdit ? () => setEditing(p) : undefined}
                >
                  <td className={cn(td, "border-b border-dashed")}>
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
                    {markOrderedButton(p)}
                  </td>
                  <td className={cn(cell, "tabular-nums")}>{p.quantity.toFixed(2)}</td>
                  <td className={cn(cell, "font-mono tabular-nums")}>{formatMoney(p.priceClient)}</td>
                  <td className={cn(cell, "font-mono tabular-nums")}>{formatMoney(p.priceClient * p.quantity)}</td>
                  <td className={cell} onClick={(e) => e.stopPropagation()}>
                    {taxableCheckbox(p, "[&>span]:text-sm")}
                  </td>
                  {canEdit ? (
                    <td className={cn(cell, "text-center")}>
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); remove.mutate(p.lineId); }}
                        disabled={remove.isPending}
                        className="text-muted-foreground hover:text-destructive"
                        aria-label={`Remove ${p.name}`}
                      >
                        {remove.isPending ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
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
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="default" size="lg" className="rounded-pill px-4 font-semibold" onClick={() => setAdding(true)}>
              <Plus /> Add item
            </Button>
            <Button variant="outline" size="lg" className="h-9 rounded-pill border-foreground/60 px-4 font-semibold" asChild>
              <Link href="/inventory/items">
                <BookOpen /> Price book
              </Link>
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
          paymentSummary={paymentSummary}
        />
      </div>

      {dialog}
    </div>
  );
}
