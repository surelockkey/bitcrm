"use client";

import { cn } from "@/lib/utils";
import type { DealTab } from "../deal-tabs";

const TAB_LABEL: Record<DealTab, string> = {
  details: "Details",
  items: "Items",
  payments: "Payments",
  estimates: "Estimates",
  invoice: "Invoice",
  attachments: "Attachments",
};

/**
 * Workiz's job tab bar (job_b_01_details): nine tabs share Workiz's width, so
 * each is a ninth of it (149px on a 1345px column) — ours, fewer, keep that
 * width and sit from the left, so each name lands where Workiz's does. A
 * 16px/500 name over a 12px grey line ("$0.00 balance", "3 attachments");
 * the open one carries a 4px ink bar along its foot, drawn over the 1px
 * #cad3d6 rule that closes the grey band (audit_pixels J7: y 389–392).
 * When the Timeline narrows the bar a ninth no longer fits the text, and
 * Workiz then sizes each tab to its text plus 18px a side (rail_chat) —
 * nothing is ever cut to "…".
 */
export function JobTabBar({
  tabs,
  active,
  onSelect,
  sublabels,
}: {
  tabs: DealTab[];
  active: DealTab;
  onSelect: (tab: DealTab) => void;
  sublabels: Record<DealTab, string>;
}) {
  return (
    <div
      role="tablist"
      aria-label="Job sections"
      className="mt-[22px] flex h-[89px] overflow-x-auto shadow-[inset_0_-1px_0_#cad3d6]"
    >
      {tabs.map((t) => {
        const selected = t === active;
        return (
          <button
            key={t}
            type="button"
            role="tab"
            id={`job-tab-${t}`}
            aria-selected={selected}
            // The name is the tab; the grey line describes it.
            aria-label={TAB_LABEL[t]}
            aria-describedby={`job-tab-${t}-sub`}
            onClick={() => onSelect(t)}
            className="relative flex w-[calc(100%/9)] min-w-max shrink-0 flex-col items-center px-[18px] pt-4 text-center outline-none focus-visible:bg-accent/60"
          >
            <span className="text-[16px] leading-4 font-medium text-[#404040]">{TAB_LABEL[t]}</span>
            <span id={`job-tab-${t}-sub`} className="mt-2 text-[12px] leading-4 whitespace-nowrap text-[#404040]">
              {sublabels[t]}
            </span>
            {/* 4px ink bar (#3e4b51, job_b_01 y 389–392) across the tab's width, over the rule. */}
            <span aria-hidden className={cn("absolute inset-x-0 bottom-0 h-1", selected ? "bg-[#3e4b51]" : "bg-transparent")} />
          </button>
        );
      })}
    </div>
  );
}
