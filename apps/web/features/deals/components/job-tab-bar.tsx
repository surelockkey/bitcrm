"use client";

import { WzTabBar } from "@/components/workiz";
import type { DealTab } from "../deal-tabs";

const TAB_LABEL: Record<DealTab, string> = {
  details: "Details",
  items: "Items",
  payments: "Payments",
  estimates: "Estimates",
  attachments: "Attachments",
};

/**
 * Workiz's job tab bar (job_b_01_details) — the kit's `WzTabBar variant="job"`
 * (a ninth of the bar per tab, a 16px/500 name over a 12px grey line, the
 * open tab's 4px bar over the rule, arrow keys) with the job's tabs named and
 * given ids, so each tabpanel can say which tab labels it (`job-tab-<tab>`).
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
    <WzTabBar
      variant="job"
      aria-label="Job sections"
      className="mt-[22px]"
      tabs={tabs.map((t) => ({ value: t, label: TAB_LABEL[t], sublabel: sublabels[t], id: `job-tab-${t}` }))}
      value={active}
      onValueChange={(v) => onSelect(v as DealTab)}
    />
  );
}
