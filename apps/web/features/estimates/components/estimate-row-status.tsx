"use client";

import { useState, type SyntheticEvent } from "react";
import { ESTIMATE_STATUSES, ESTIMATE_STATUS_LABELS, type Estimate, type EstimateStatus } from "@bitcrm/types";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ESTIMATE_STATUS_COLORS } from "@/features/reports/billing/lib";
import { useSetEstimateStatus } from "../hooks";

/**
 * Workiz's 8px status dot, 8px before the word (uikit_wz_est_status_open):
 * it sits on the text's baseline, 7px down the 20px line, not centred on it.
 */
function Dot({ status }: { status: EstimateStatus }) {
  return (
    <span
      aria-hidden
      className="inline-block size-2 shrink-0 translate-y-px rounded-full"
      style={{ backgroundColor: ESTIMATE_STATUS_COLORS[status] }}
    />
  );
}

/** The word with its dot: 14px/20px #333, as react-select's single value. */
function StatusWord({ status }: { status: EstimateStatus }) {
  return (
    <span className="inline-flex items-center gap-2 text-sm leading-5">
      <Dot status={status} />
      {ESTIMATE_STATUS_LABELS[status]}
    </span>
  );
}

/** The row opens the estimate; nothing done inside the select may reach it. */
const keep = (e: SyntheticEvent) => e.stopPropagation();

/**
 * The Status cell of Workiz's Estimates list (uikit_wz_estimates,
 * uikit_wz_est_status_open): the status as a borderless react-select — the
 * dot, the word and a thin chevron — whose menu (169px, 36px rows with their
 * dots, the chosen one #2684ff) sets the estimate's status in place. A
 * reader who may not edit estimates gets the word alone.
 *
 * The pick shows at once and stays until the list comes back with it.
 */
export function EstimateRowStatus({ estimate, editable }: { estimate: Estimate; editable: boolean }) {
  const setStatus = useSetEstimateStatus(estimate.id, estimate.dealId);
  const [picked, setPicked] = useState<EstimateStatus | null>(null);
  const [seen, setSeen] = useState(estimate.status);
  // The list answered with the estimate's new status: it speaks for itself again.
  if (seen !== estimate.status) {
    setSeen(estimate.status);
    setPicked(null);
  }
  const shown = picked ?? estimate.status;

  if (!editable) {
    return (
      <div className="-mt-[3px] text-[#333333]">
        <StatusWord status={shown} />
      </div>
    );
  }

  return (
    // React carries the menu's events up through its portal: they stop here.
    <div className="-mt-[3px] w-fit" onClick={keep} onKeyDown={keep}>
      <Select
        value={shown}
        disabled={setStatus.isPending}
        onValueChange={(v) => {
          const next = v as EstimateStatus;
          if (next === shown) return;
          setPicked(next);
          setStatus.mutate(next, { onError: () => setPicked(null) });
        }}
      >
        <SelectTrigger
          size="sm"
          aria-label={`Status of estimate ${estimate.number}`}
          className="h-5 gap-[5px] rounded-none border-0 bg-transparent p-0 text-[#333333] data-[size=sm]:h-5 data-[size=sm]:pl-0 hover:border-0 disabled:bg-transparent disabled:text-[#333333] data-[state=open]:shadow-none [&>svg]:size-3.5! [&>svg]:text-[#333333]! [&>svg]:transition-transform data-[state=open]:[&>svg]:rotate-180"
        >
          <SelectValue />
        </SelectTrigger>
        {/* uikit_wz_est_status_open: 169px, 10px under the word. */}
        <SelectContent className="w-[169px] min-w-[169px] data-[side=bottom]:translate-y-2.5">
          {ESTIMATE_STATUSES.map((s) => (
            <SelectItem key={s} value={s} className="pr-3 text-foreground [&>span:first-child]:hidden">
              <StatusWord status={s} />
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
