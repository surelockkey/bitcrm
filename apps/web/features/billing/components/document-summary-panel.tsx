"use client";

import { useState } from "react";
import { Loader2, Pencil, Plus, RotateCcw, ShieldCheck, X } from "lucide-react";
import type { DocumentDiscount, DocumentTaxSource, DocumentTotals } from "@bitcrm/types";
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
  className?: string;
}

/**
 * Workiz-style document footer: Subtotal → Discount → Tax → Total
 * (→ Paid → Balance due). Props-driven so the job Items tab, estimates and
 * invoices share it; the caller wires the callbacks to its own mutations.
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
  className,
}: DocumentSummaryPanelProps) {
  const [editingDiscount, setEditingDiscount] = useState(false);
  const exempt = taxSource === "exempt";
  const auto = isAutoTaxSource(taxSource);
  const hasDiscount = Boolean(discount && discount.value > 0);

  return (
    <section
      aria-label="Totals"
      aria-busy={pending || undefined}
      className={cn("w-full space-y-2 rounded-lg border bg-muted/20 p-3 text-sm sm:max-w-sm", className)}
    >
      <Row label="Subtotal" value={formatMoney(totals.subtotal)} />

      {/* Discount */}
      {editingDiscount ? (
        <DiscountEditor
          initial={discount}
          pending={pending}
          onCancel={() => setEditingDiscount(false)}
          onApply={(d) => {
            onDiscountChange(d);
            setEditingDiscount(false);
          }}
        />
      ) : hasDiscount ? (
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-1">
            <span className="text-muted-foreground">
              Discount{discount!.type === "percent" ? ` (${discountLabel(discount)})` : ""}
            </span>
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
          </div>
          <span className="font-mono tabular-nums">−{formatMoney(totals.discount)}</span>
        </div>
      ) : canEdit ? (
        <button
          type="button"
          disabled={pending}
          onClick={() => setEditingDiscount(true)}
          className="inline-flex items-center gap-1 text-xs font-medium text-brand hover:underline disabled:opacity-50"
        >
          <Plus className="size-3" /> Add discount
        </button>
      ) : null}

      {/* Tax */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
            <span className="text-muted-foreground">Tax</span>
            {exempt ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Badge
                    variant="outline"
                    tabIndex={0}
                    className="gap-1 border-emerald-500/40 font-normal text-emerald-700 dark:text-emerald-400"
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
            {!canEdit ? (
              <span className="truncate text-muted-foreground">
                {taxRateId || totals.taxRatePercent > 0
                  ? `${taxRateName ?? "Tax"} ${formatPercent(totals.taxRatePercent)}`
                  : ""}
              </span>
            ) : null}
          </div>
          <span className="flex items-center gap-1.5 font-mono tabular-nums">
            {pending ? <Loader2 className="size-3 animate-spin text-muted-foreground" aria-hidden /> : null}
            {formatMoney(totals.tax)}
          </span>
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

      <div className="border-t pt-2">
        <Row label="Total" value={formatMoney(totals.total)} strong />
      </div>

      {showPayments ? (
        <>
          <Row label="Paid" value={`−${formatMoney(totals.amountPaid)}`} />
          <Row
            label="Balance due"
            value={formatMoney(totals.balanceDue)}
            strong
            className={totals.balanceDue > 0 ? "text-foreground" : "text-emerald-700 dark:text-emerald-400"}
          />
        </>
      ) : null}
    </section>
  );
}

function Row({
  label,
  value,
  strong,
  className,
}: {
  label: string;
  value: string;
  strong?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("flex items-center justify-between gap-2", strong && "text-base font-semibold", className)}>
      <span className={strong ? undefined : "text-muted-foreground"}>{label}</span>
      <span className="font-mono tabular-nums">{value}</span>
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
