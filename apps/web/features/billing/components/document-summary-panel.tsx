"use client";

import { useState, type ReactNode } from "react";
import { Loader2, Pencil, Plus, RotateCcw, ShieldCheck, X } from "lucide-react";
import type { DocumentDiscount, DocumentTaxSource, DocumentTotals, PaymentSummary } from "@bitcrm/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import {
  discountLabel,
  formatMoney,
  formatPercent,
  isAutoTaxSource,
  normalizeDiscount,
  taxSourceLabel,
} from "../lib";
import { TaxRateSelect } from "./tax-rate-select";

export interface DocumentSummaryPanelProps {
  /** Server (or locally computed) totals — the panel never does money math. */
  totals: DocumentTotals;
  /** The document's current tax-rate id (absent = no tax). */
  taxRateId?: string;
  /** Snapshotted rate name, shown when the rate left the catalog or read-only. */
  taxRateName?: string;
  taxSource?: DocumentTaxSource;
  discount?: DocumentDiscount;
  canEdit: boolean;
  /** Picking a rate (or "No tax" → null) is a manual choice. */
  onTaxChange: (taxRateId: string | null) => void;
  /** Re-resolve the tax automatically; the action is hidden when omitted. */
  onResetTaxAuto?: () => void;
  /** `null` removes the discount. */
  onDiscountChange: (discount: DocumentDiscount | null) => void;
  /** Extra detail for an exempt client, e.g. the exemption reason. */
  exemptLabel?: string;
  /** A tax/discount mutation is in flight — controls are disabled. */
  pending?: boolean;
  /** Show the Paid / Balance due rows (invoices). */
  showPayments?: boolean;
  /**
   * The invoice's real ledger. Only used to add the "clearing" line — money
   * taken but not landed is never deducted from the balance.
   */
  paymentSummary?: PaymentSummary;
  /** Rows a document adds between Tax and Total (an estimate's Item cost and Deposit). */
  extraRows?: ReactNode;
  className?: string;
}

/**
 * The document's footer, laid out like Workiz's Subtotal → Discount → Taxable
 * → Tax rate → Tax → Total column and tidied up: one quiet card, every amount
 * right-aligned in the same column, the editors inline where the value is,
 * and the Total set apart with a rule. Props-driven so the job Items tab,
 * estimates and invoices share it; the caller wires the callbacks.
 */
export function DocumentSummaryPanel({
  totals,
  taxRateId,
  taxRateName,
  taxSource,
  discount,
  canEdit,
  onTaxChange,
  onResetTaxAuto,
  onDiscountChange,
  exemptLabel,
  pending = false,
  showPayments = false,
  paymentSummary,
  extraRows,
  className,
}: DocumentSummaryPanelProps) {
  const [editingDiscount, setEditingDiscount] = useState(false);
  const exempt = taxSource === "exempt";
  const auto = isAutoTaxSource(taxSource);
  const hasDiscount = Boolean(discount && discount.value > 0);
  const taxLabel =
    exempt ? "Exempt" : taxRateId || totals.taxRatePercent > 0 ? `${taxRateName ?? "Tax"} ${formatPercent(totals.taxRatePercent)}` : "No tax";

  return (
    <section
      aria-label="Totals"
      aria-busy={pending || undefined}
      className={cn("w-full rounded-lg border bg-card text-sm sm:max-w-sm", className)}
    >
      <dl className="divide-y">
        <Row label="Subtotal" value={formatMoney(totals.subtotal)} />

        {/* Discount */}
        {editingDiscount ? (
          <div className="px-4 py-2.5">
            <DiscountEditor
              initial={discount}
              pending={pending}
              onCancel={() => setEditingDiscount(false)}
              onApply={(d) => {
                onDiscountChange(d);
                setEditingDiscount(false);
              }}
            />
          </div>
        ) : hasDiscount ? (
          <div className="flex items-center justify-between gap-2 px-4 py-2.5">
            <dt className="flex min-w-0 items-center gap-1 text-muted-foreground">
              <span>Discount{discount!.type === "percent" ? ` (${discountLabel(discount)})` : ""}</span>
              {canEdit ? (
                <>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-6"
                    disabled={pending}
                    onClick={() => setEditingDiscount(true)}
                    aria-label="Edit discount"
                  >
                    <Pencil className="size-3" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-6 hover:text-destructive"
                    disabled={pending}
                    onClick={() => onDiscountChange(null)}
                    aria-label="Remove discount"
                  >
                    <X className="size-3" />
                  </Button>
                </>
              ) : null}
            </dt>
            <dd className="font-mono tabular-nums text-success-text">−{formatMoney(totals.discount)}</dd>
          </div>
        ) : (
          <div className="flex items-center justify-between gap-2 px-4 py-2.5">
            <dt className="text-muted-foreground">Discount</dt>
            <dd className="font-mono tabular-nums">
              {canEdit ? (
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => setEditingDiscount(true)}
                  className="inline-flex items-center gap-1 font-sans text-xs font-medium text-brand hover:underline disabled:opacity-50"
                >
                  <Plus className="size-3" /> Add discount
                </button>
              ) : (
                formatMoney(0)
              )}
            </dd>
          </div>
        )}

        {/* Taxable base — only worth a line when some lines are not taxed. */}
        {totals.nonTaxableSubtotal > 0 ? <Row label="Taxable" value={formatMoney(totals.taxableBase)} /> : null}

        {/* Tax */}
        <div className="space-y-1.5 px-4 py-2.5">
          <div className="flex items-center justify-between gap-2">
            <dt className="flex min-w-0 flex-wrap items-center gap-1.5 text-muted-foreground">
              <span>Tax</span>
              {exempt ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Badge
                      variant="outline"
                      tabIndex={0}
                      className="gap-1 border-success/40 font-normal text-success-text"
                    >
                      <ShieldCheck /> Exempt
                    </Badge>
                  </TooltipTrigger>
                  <TooltipContent>
                    {exemptLabel ? `${taxSourceLabel("exempt")} — ${exemptLabel}` : taxSourceLabel("exempt")}
                  </TooltipContent>
                </Tooltip>
              ) : auto ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Badge variant="secondary" tabIndex={0} className="font-normal">
                      Auto
                    </Badge>
                  </TooltipTrigger>
                  <TooltipContent>{taxSourceLabel(taxSource)}</TooltipContent>
                </Tooltip>
              ) : null}
              {!canEdit ? <span className="truncate">{exempt ? "" : taxLabel}</span> : null}
            </dt>
            <dd className="flex items-center gap-1.5 font-mono tabular-nums">
              {pending ? <Loader2 className="size-3 animate-spin text-muted-foreground" aria-hidden /> : null}
              {formatMoney(totals.tax)}
            </dd>
          </div>

          {canEdit ? (
            <div className="flex items-center gap-1.5">
              <TaxRateSelect
                size="sm"
                value={taxRateId ?? null}
                onChange={onTaxChange}
                disabled={pending}
                fallbackLabel={taxRateName}
                fallbackPercent={totals.taxRatePercent}
                className="min-w-0 flex-1"
              />
              {onResetTaxAuto && taxSource === "manual" ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-7 flex-none"
                      disabled={pending}
                      onClick={onResetTaxAuto}
                      aria-label="Reset tax to automatic"
                    >
                      <RotateCcw className="size-3.5" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Reset to automatic (client exemption → the job&apos;s service area tax)</TooltipContent>
                </Tooltip>
              ) : null}
            </div>
          ) : null}

          {totals.tax > 0 && totals.nonTaxableSubtotal > 0 ? (
            <p className="text-[11px] text-muted-foreground">
              {formatPercent(totals.taxRatePercent)} on {formatMoney(totals.taxableBase)} taxable
            </p>
          ) : null}
        </div>

        {extraRows}

        <div className="flex items-center justify-between gap-2 bg-muted/60 px-4 py-3 text-base font-semibold">
          <dt>Total</dt>
          <dd className="font-mono tabular-nums">{formatMoney(totals.total)}</dd>
        </div>

        {showPayments ? (
          <>
            <Row label="Paid" value={`−${formatMoney(totals.amountPaid)}`} />
            {paymentSummary?.hasPending ? (
              <>
                <Row label="Clearing" value={formatMoney(paymentSummary.pending)} />
                <p className="px-4 pb-2 text-[11px] text-muted-foreground">
                  A bank payment is on its way — not counted until it lands.
                </p>
              </>
            ) : null}
            <div
              className={cn(
                "flex items-center justify-between gap-2 px-4 py-3 text-base font-semibold",
                totals.balanceDue > 0 ? "text-foreground" : "text-success-text",
              )}
            >
              <dt>Balance due</dt>
              <dd className="font-mono tabular-nums">{formatMoney(totals.balanceDue)}</dd>
            </div>
          </>
        ) : null}
      </dl>
    </section>
  );
}

/** One label / amount line of the footer. Exported for the rows a document adds of its own. */
export function Row({
  label,
  value,
  hint,
  action,
  className,
}: {
  label: ReactNode;
  value: ReactNode;
  /** Small print under the amount (a margin, a percent). */
  hint?: ReactNode;
  /** A control beside the label (Workiz underlines the label; we give it a button). */
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex items-center justify-between gap-2 px-4 py-2.5", className)}>
      <dt className="flex min-w-0 items-center gap-1.5 text-muted-foreground">
        {label}
        {action}
      </dt>
      <dd className="text-right">
        <span className="font-mono tabular-nums">{value}</span>
        {hint ? <span className="block text-[11px] text-muted-foreground">{hint}</span> : null}
      </dd>
    </div>
  );
}

function DiscountEditor({
  initial,
  pending,
  onApply,
  onCancel,
}: {
  initial?: DocumentDiscount;
  pending: boolean;
  onApply: (d: DocumentDiscount | null) => void;
  onCancel: () => void;
}) {
  const [type, setType] = useState<DocumentDiscount["type"]>(initial?.type ?? "amount");
  const [value, setValue] = useState(initial ? String(initial.value) : "");
  const next = normalizeDiscount(type, value);
  const invalid = value.trim() !== "" && next === null;

  const apply = () => {
    if (invalid) return;
    onApply(next);
  };

  return (
    <form
      className="space-y-1.5"
      onSubmit={(e) => {
        e.preventDefault();
        apply();
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          onCancel();
        }
      }}
    >
      <div className="flex items-center gap-1.5">
        <span className="text-muted-foreground">Discount</span>
        <div role="radiogroup" aria-label="Discount type" className="ml-auto flex rounded-md border p-0.5">
          {(["amount", "percent"] as const).map((t) => (
            <button
              key={t}
              type="button"
              role="radio"
              aria-checked={type === t}
              aria-label={t === "amount" ? "Dollar amount" : "Percent"}
              onClick={() => setType(t)}
              className={cn(
                "h-6 min-w-7 rounded px-1.5 text-xs font-medium transition-colors",
                type === t ? "bg-brand text-brand-foreground" : "text-muted-foreground hover:bg-muted",
              )}
            >
              {t === "amount" ? "$" : "%"}
            </button>
          ))}
        </div>
      </div>
      <div className="flex items-center gap-1.5">
        <Input
          type="number"
          inputMode="decimal"
          min={0}
          max={type === "percent" ? 100 : undefined}
          step={type === "percent" ? "0.001" : "0.01"}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={type === "percent" ? "0 %" : "0.00"}
          aria-label={type === "percent" ? "Discount percent" : "Discount amount"}
          aria-invalid={invalid}
          className="h-8 min-w-0 flex-1 tabular-nums"
          autoFocus
        />
        <Button type="submit" size="sm" variant="brand" className="h-8" disabled={pending || invalid}>
          Apply
        </Button>
        <Button type="button" size="sm" variant="ghost" className="h-8" onClick={onCancel}>
          Cancel
        </Button>
      </div>
      {invalid ? <p className="text-xs text-destructive">Enter a positive number</p> : null}
    </form>
  );
}
