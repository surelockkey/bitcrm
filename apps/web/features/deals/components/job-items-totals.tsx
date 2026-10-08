"use client";

import { useState, type ReactNode } from "react";
import { Info, Loader2, RotateCcw } from "lucide-react";
import type { DocumentDiscount, DocumentTaxSource, DocumentTotals } from "@bitcrm/types";
import { cn } from "@/lib/utils";
import { DiscountEditor } from "@/features/billing/components/document-summary-panel";
import { TaxRateSelect } from "@/features/billing/components/tax-rate-select";
import { discountLabel, formatPercent } from "@/features/billing/lib";
import { formatBoxAmount } from "../job-shell";

/** Workiz's totals box: 132×28, #f7f7f7 on a 1px #ccc line, r2, 14px #666 (job_b_tab_items). */
const BOX = "h-7 w-[132px] shrink-0 rounded-[2px] border border-[#cccccc] bg-[#f7f7f7] px-2.5 text-left text-[14px] leading-[26px] text-[#666666] tabular-nums";

/**
 * The foot of Workiz's job Items tab: Total / Balance on the left, Subtotal →
 * Discount → Taxable → Tax rate% → Tax (→ Job costing) on the right, each a
 * label and a small grey box. Workiz's Tech expenses, Tech invoice, Labor
 * cost, Card expenses and "Add payment schedule" have nothing behind them in
 * BitCRM and are not drawn.
 */
export function JobItemsTotals({
  totals,
  balance,
  due,
  cost,
  taxRateId,
  taxRateName,
  taxSource,
  discount,
  canEdit,
  pending = false,
  onTaxChange,
  onResetTaxAuto,
  onDiscountChange,
  exemptLabel,
}: {
  totals: DocumentTotals;
  /** What is still owed on the job (the ledger's, else the job row's). */
  balance: number;
  /** The invoice's due date, when the job has an invoice. */
  due?: string;
  /** Workiz "Job costing" — the lines' company cost; absent hides the row. */
  cost?: number;
  taxRateId?: string;
  taxRateName?: string;
  taxSource?: DocumentTaxSource;
  discount?: DocumentDiscount;
  canEdit: boolean;
  pending?: boolean;
  onTaxChange: (taxRateId: string | null) => void;
  onResetTaxAuto?: () => void;
  onDiscountChange: (d: DocumentDiscount | null) => void;
  exemptLabel?: string;
}) {
  const [editingDiscount, setEditingDiscount] = useState(false);
  const exempt = taxSource === "exempt";
  const taxText = exempt
    ? "Exempt"
    : taxRateId || totals.taxRatePercent > 0
      ? `${taxRateName ?? "Tax"} (${formatPercent(totals.taxRatePercent)})`
      : "No tax";

  return (
    <section aria-label="Totals" aria-busy={pending || undefined} className="mt-[62px] grid grid-cols-1 gap-y-[5px] md:grid-cols-2">
      <div className="flex flex-col items-end gap-[5px] md:pr-9">
        <BoxRow label="Total">{formatBoxAmount(totals.total)}</BoxRow>
        <BoxRow label="Balance" bold>
          {formatBoxAmount(balance)}
        </BoxRow>
        {due ? <BoxRow label="Due">{due}</BoxRow> : null}
      </div>

      <div className="flex flex-col items-end gap-[5px]">
        <BoxRow label="Subtotal">{formatBoxAmount(totals.subtotal)}</BoxRow>
        <BoxRow
          label="Discount"
          colon={false}
          hint={
            <Info
              aria-hidden
              className="size-[18px] text-foreground"
              strokeWidth={1.25}
            />
          }
          onClick={canEdit && !pending ? () => setEditingDiscount((v) => !v) : undefined}
          title={discount && discount.value > 0 ? `Discount ${discountLabel(discount)}` : canEdit ? "Add a discount" : undefined}
        >
          {formatBoxAmount(totals.discount)}
        </BoxRow>
        {editingDiscount ? (
          <div className="w-[300px] rounded-[2px] border border-[#cccccc] bg-white p-2.5 text-[14px]">
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
        ) : null}
        <BoxRow label="Taxable" className="mt-[5px]">
          {formatBoxAmount(totals.taxableBase)}
        </BoxRow>
        <div className="flex items-center gap-2.5">
          {canEdit && onResetTaxAuto && taxSource === "manual" ? (
            <button
              type="button"
              aria-label="Reset tax to automatic"
              title="Reset to automatic (client exemption → the job's service area tax)"
              disabled={pending}
              onClick={onResetTaxAuto}
              className="grid size-6 place-items-center rounded-[4px] text-foreground hover:bg-[#f3f6f7]"
            >
              <RotateCcw className="size-3.5" />
            </button>
          ) : null}
          <span className="text-[14px] leading-4 text-[#404040]">Tax rate% :</span>
          {canEdit ? (
            <TaxRateSelect
              size="sm"
              value={taxRateId ?? null}
              onChange={onTaxChange}
              disabled={pending}
              fallbackLabel={taxRateName}
              fallbackPercent={totals.taxRatePercent}
              aria-label="Tax rate"
              className="h-[26px]! w-[132px] rounded-[2px]! border-[#cccccc] bg-[#f7f7f7] px-2.5 text-[14px] text-[#666666] shadow-none data-[size=sm]:h-[26px]"
            />
          ) : (
            <span role="group" aria-label="Tax rate" className={cn(BOX, "truncate")}>
              {taxText}
            </span>
          )}
        </div>
        <BoxRow label="Tax">
          {pending ? <Loader2 className="mr-1 inline size-3 animate-spin" aria-hidden /> : null}
          {formatBoxAmount(totals.tax)}
        </BoxRow>
        {cost !== undefined ? (
          <BoxRow label="Job costing" underline>
            {formatBoxAmount(cost)}
          </BoxRow>
        ) : null}
        {exempt ? (
          <p className="max-w-[300px] text-right text-[12px] text-[#404040]">
            Tax exempt{exemptLabel ? ` — ${exemptLabel}` : ""}
          </p>
        ) : null}
      </div>
    </section>
  );
}

function BoxRow({
  label,
  children,
  bold,
  colon = true,
  underline,
  hint,
  onClick,
  title,
  className,
}: {
  label: string;
  children: ReactNode;
  bold?: boolean;
  colon?: boolean;
  underline?: boolean;
  hint?: ReactNode;
  onClick?: () => void;
  title?: string;
  className?: string;
}) {
  const box = cn(BOX, bold && "font-bold", onClick && "cursor-pointer hover:border-[#6aa8ee]");
  return (
    <div role="group" aria-label={label} className={cn("flex items-center gap-2.5", className)}>
      <span className={cn("text-[14px] leading-5 text-[#404040]", underline && "underline")}>
        {label}
        {colon ? " :" : ":"}
      </span>
      {hint}
      {onClick ? (
        <button type="button" onClick={onClick} title={title} className={box}>
          {children}
        </button>
      ) : (
        <span title={title} className={box}>
          {children}
        </span>
      )}
    </div>
  );
}
