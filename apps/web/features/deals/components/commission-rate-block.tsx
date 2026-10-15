"use client";

import { useState } from "react";
import { WzButton } from "@/components/workiz/button";
import { WzOnOffSwitch } from "@/components/workiz/on-off-switch";
import { WzSwitchTabs } from "@/components/workiz/switch-tabs";
import { cn } from "@/lib/utils";
import { formatMoney } from "../lib";

export type TechRateUnit = "%" | "$";

/** The job's Custom Tech Rate as it holds it (`Deal.useTechSpecialRate`, `techSpecialRate`, `techSpecialRateUnit`). */
export interface TechRateState {
  useTechSpecialRate?: boolean;
  techSpecialRate?: number;
  techSpecialRateUnit?: TechRateUnit;
}

/** What Update writes: on with a rate and its unit, or off (the rate stays on the job for next time). */
export type TechRateUpdate =
  | { useTechSpecialRate: true; techSpecialRate: number; techSpecialRateUnit: TechRateUnit }
  | { useTechSpecialRate: false };

const UNITS = [
  { value: "%", label: "%" },
  { value: "$", label: "$" },
] as const;

/** The totals column's box, as a typed field: 132×28, #f7f7f7 on a 1px #ccc line. */
const BOX = "h-7 w-[132px] rounded-[2px] border border-[#cccccc] bg-[#f7f7f7] px-2.5 text-[14px] leading-[26px] text-[#666666] tabular-nums outline-none focus:border-[#6aa8ee]";

const stateKey = (r: TechRateState) => `${r.useTechSpecialRate === true}|${r.techSpecialRate ?? ""}|${r.techSpecialRateUnit ?? "%"}`;

/**
 * Workiz's "Commission rate" block on the job (app_audit_wz_disp_job_tab_items,
 * 400px wide under the Items totals): h4 "Commission rate" (18px/400 #3b4b52)
 * with a yellow compact "Update" at the right, then "Custom Tech Rate:" (14px
 * bold) with Workiz's 80×24 OFF/ON switch. On, this job pays its technician
 * the rate typed here — % of the commission split, or a fixed $ — instead of
 * his settings' and his job-type rules; the commissions report takes it as
 * long as it is on. Update writes the job; nothing is written until then.
 *
 * Workiz's second row, "Custom Referral Rate" (the external company's rate on
 * this job), is not drawn: BitCRM holds no rates for external companies, so
 * the report could not use one.
 */
export function CommissionRateBlock({
  rate,
  canEdit,
  pending,
  onUpdate,
  className,
}: {
  rate: TechRateState;
  /** `commission.edit` (Workiz "Override Rates"): the switch, the rate and Update. */
  canEdit: boolean;
  pending: boolean;
  onUpdate: (update: TechRateUpdate) => void;
  className?: string;
}) {
  const [on, setOn] = useState(rate.useTechSpecialRate === true);
  const [text, setText] = useState(rate.techSpecialRate !== undefined ? String(rate.techSpecialRate) : "");
  const [unit, setUnit] = useState<TechRateUnit>(rate.techSpecialRateUnit ?? "%");
  // The job's state changed under the block (Update landed, a refetch): show it.
  const [seen, setSeen] = useState(stateKey(rate));
  if (seen !== stateKey(rate)) {
    setSeen(stateKey(rate));
    setOn(rate.useTechSpecialRate === true);
    setText(rate.techSpecialRate !== undefined ? String(rate.techSpecialRate) : "");
    setUnit(rate.techSpecialRateUnit ?? "%");
  }

  const value = text.trim() === "" ? null : Number(text.trim());
  const tooHigh = value !== null && unit === "%" && value > 100;
  const valid = value !== null && Number.isFinite(value) && value >= 0 && !tooHigh;
  const wasOn = rate.useTechSpecialRate === true;
  const changed = on !== wasOn || (on && (value !== (rate.techSpecialRate ?? null) || unit !== (rate.techSpecialRateUnit ?? "%")));
  const canUpdate = canEdit && !pending && changed && (!on || valid);

  const submit = () => {
    if (!canUpdate) return;
    if (on) onUpdate({ useTechSpecialRate: true, techSpecialRate: value as number, techSpecialRateUnit: unit });
    else onUpdate({ useTechSpecialRate: false });
  };

  return (
    <section aria-labelledby="commission-rate-heading" className={cn("w-[400px] text-[#404040]", className)}>
      <div className="flex items-center justify-between">
        <h4 id="commission-rate-heading" className="text-[18px] leading-[27px] font-normal text-[#3b4b52]">
          Commission rate
        </h4>
        {canEdit ? (
          <WzButton size="regular" className="h-[27px] max-h-[27px] px-4 py-0" disabled={!canUpdate} loading={pending} onClick={submit}>
            Update
          </WzButton>
        ) : null}
      </div>

      <div className="mt-7 flex items-center justify-between">
        <b className="text-[14px] leading-4 font-bold">Custom Tech Rate:</b>
        <WzOnOffSwitch aria-label="Custom Tech Rate" checked={on} disabled={!canEdit || pending} onCheckedChange={setOn} />
      </div>

      {on ? (
        canEdit ? (
          <div className="mt-3 flex items-center gap-3">
            <input
              type="text"
              inputMode="decimal"
              aria-label="Custom tech rate"
              value={text}
              disabled={pending}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") submit();
              }}
              className={BOX}
            />
            <WzSwitchTabs aria-label="Rate unit" tabs={UNITS} value={unit} onChange={setUnit} />
            {tooHigh ? <span className="text-[12px] leading-4 text-[#f45e44]">A percentage stays within 100</span> : null}
          </div>
        ) : (
          <p className="mt-3 text-[14px] leading-4">
            {rate.techSpecialRateUnit === "$" ? formatMoney(rate.techSpecialRate ?? 0) : `${rate.techSpecialRate ?? 0}%`}
          </p>
        )
      ) : null}
    </section>
  );
}
