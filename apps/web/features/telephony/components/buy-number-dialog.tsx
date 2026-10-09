"use client";

import { useState } from "react";
import { WzButton } from "@/components/workiz/button";
import { WzDrawer } from "@/components/workiz/drawer";
import { WzOutlinedTextField } from "@/components/workiz/outlined-text-field";
import { formatPhone } from "@/lib/phone";
import { useAvailableNumbers, useBuyNumber } from "../numbers-hooks";
import { formatMonthlyPrice, type AvailableSearch } from "../numbers-api";

/** 13px/19px 600 ink — the pane's "Select country" / "Number type" words. */
const PANE_LABEL = "mb-2 text-[13px] leading-[19px] font-semibold tracking-[0.4px] text-foreground";

/**
 * Workiz Phone → Phone numbers → "Add number": the "Get a number" right pane
 * (pg_settings_phone_wz_numbers_add_open / _add_results) — 440px, Area code
 * (113px) beside "Contains (optional)", the outline "Search" pill at the
 * right, Workiz's red line when nothing matches. Ours searches US local
 * numbers only, so Workiz's country select and Local | Toll-free switch are
 * left out. Buying provisions the number for inbound at once.
 */
export function BuyNumberDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [areaCode, setAreaCode] = useState("");
  const [contains, setContains] = useState("");
  // Only the submitted params drive the query, so typing doesn't spam Twilio.
  const [submitted, setSubmitted] = useState<AvailableSearch | null>(null);

  const { data: results, isFetching } = useAvailableNumbers(submitted ?? {}, submitted !== null);
  const buy = useBuyNumber();

  const search = () => setSubmitted({ country: "US", areaCode: areaCode.trim(), contains: contains.trim() });
  const none = submitted !== null && !isFetching && (!results || results.length === 0);

  return (
    <WzDrawer open={open} onOpenChange={onOpenChange} title="Get a number" width={440} bodyClassName="px-6 pt-3">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          search();
        }}
      >
        <p className={PANE_LABEL}>Find a number</p>
        <div className="flex gap-4">
          <WzOutlinedTextField
            aria-label="Area code"
            placeholder="Area code"
            inputMode="numeric"
            value={areaCode}
            onChange={(e) => setAreaCode(e.target.value)}
            className="w-[113px] shrink-0"
          />
          <WzOutlinedTextField
            aria-label="Contains (optional)"
            placeholder="Contains (optional)"
            value={contains}
            onChange={(e) => setContains(e.target.value)}
            className="min-w-0 flex-1"
          />
        </div>
        {none ? (
          <p role="alert" className="mt-2 text-xs leading-[18px] tracking-[0.4px] text-wz-danger">
            No numbers exist for this area code; please select another or adjust your preferences
          </p>
        ) : null}
        <div className="mt-6 flex justify-end">
          <WzButton type="submit" variant="secondary" loading={isFetching}>
            Search
          </WzButton>
        </div>
      </form>

      {results && results.length > 0 && !isFetching ? (
        <ul aria-label="Available numbers" className="mt-6 border-t border-wz-frame">
          {results.map((n) => (
            <li key={n.phoneNumber} className="flex items-center justify-between gap-3 border-b border-wz-frame py-3">
              <div className="min-w-0">
                <div className="text-sm leading-4 text-wz-strong">{formatPhone(n.phoneNumber)}</div>
                <div className="mt-1 truncate text-xs leading-4 text-wz-caption">
                  {[n.locality, n.region].filter(Boolean).join(", ")}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-3">
                {formatMonthlyPrice(n.price, n.priceUnit) ? (
                  <span className="text-[13px] text-wz-slate">{formatMonthlyPrice(n.price, n.priceUnit)}</span>
                ) : null}
                <WzButton
                  size="regular"
                  loading={buy.isPending && buy.variables === n.phoneNumber}
                  disabled={buy.isPending}
                  aria-label={`Buy ${formatPhone(n.phoneNumber)}`}
                  onClick={() => buy.mutate(n.phoneNumber, { onSuccess: () => onOpenChange(false) })}
                >
                  Buy
                </WzButton>
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </WzDrawer>
  );
}
