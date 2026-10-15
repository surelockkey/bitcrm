"use client";

import { useState } from "react";
import type { Deal } from "@bitcrm/types";
import { useDealTotals, useUpdateDeal } from "../../hooks";
import type { UpdateDealValues } from "../../schemas";
import { QvFloatField, QvFold } from "./parts";

const box = (n: number | undefined) => (typeof n === "number" ? n.toFixed(2) : "");

/** "1,234.5" → 1234.5; nothing or noise → undefined. */
export function parseMoney(text: string): number | undefined {
  const t = text.replace(/[^0-9.-]/g, "");
  if (!t) return undefined;
  const n = Number(t);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : undefined;
}

/**
 * One money box: typed freely, written on Enter or on leaving when the
 * amount differs from what the job holds; an emptied box clears the amount.
 */
function MoneyBox({
  label,
  amount,
  disabled,
  onCommit,
}: {
  label: string;
  amount: number | undefined;
  disabled?: boolean;
  onCommit?: (next: number | null) => void;
}) {
  const [text, setText] = useState(box(amount));
  // The job's amount changed under the box (a save, a refetch): show it.
  const [seen, setSeen] = useState(amount);
  if (seen !== amount) {
    setSeen(amount);
    setText(box(amount));
  }
  return (
    <QvFloatField
      label={label}
      value={text}
      disabled={disabled}
      onChange={setText}
      onCommit={() => {
        const next = parseMoney(text);
        if (next === amount || (next === undefined && amount === undefined)) {
          setText(box(amount));
          return;
        }
        onCommit?.(next ?? null);
      }}
    />
  );
}

/**
 * Workiz's Finance (quickview_wz_details_expanded_bottom): Total · Due /
 * Tech Cost · Company Cost in two 188px columns. Total is typed only while
 * the job has no line items (quickview_wz_items_job_ANQ7B7_finance: with
 * lines it is the items' total, read-only); Due is always read-only — what
 * is still owed; the two costs are the job's own amounts.
 */
export function FinanceBlock({ deal, canEdit }: { deal: Deal; canEdit: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <QvFold title="Finance" open={open} onOpenChange={setOpen}>
      <FinanceBody deal={deal} canEdit={canEdit} />
    </QvFold>
  );
}

function FinanceBody({ deal, canEdit }: { deal: Deal; canEdit: boolean }) {
  const update = useUpdateDeal(deal.id);
  const { data: totals } = useDealTotals(deal.id);
  const hasLines = (deal.itemCount ?? 0) > 0;
  const total = deal.totals?.total ?? totals?.total ?? 0;
  const due = totals?.balanceDue ?? Math.max(0, total - (deal.amountPaid ?? 0));
  const put = (patch: UpdateDealValues) => update.mutate(patch, {});
  return (
    <div className="grid grid-cols-[188px_188px] gap-x-4 gap-y-[22px] pt-1 pb-2">
      <MoneyBox label="Total" amount={total} disabled={!canEdit || hasLines} onCommit={(next) => put({ total: next })} />
      <MoneyBox label="Due" amount={due} disabled />
      <MoneyBox label="Tech Cost" amount={deal.techCost} disabled={!canEdit} onCommit={(next) => put({ techCost: next })} />
      <MoneyBox label="Company Cost" amount={deal.companyCost} disabled={!canEdit} onCommit={(next) => put({ companyCost: next })} />
    </div>
  );
}
