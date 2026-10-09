"use client";

import type { ReactNode } from "react";
import { RefreshCw, Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { WzSearchBox } from "@/components/workiz";
import { WzMiniToggle, WzSwitchTabs } from "@/components/workiz/switch-tabs";
import { cn } from "@/lib/utils";

export type MapTab = "jobs" | "techs";

const TABS = [
  { value: "jobs", label: "Jobs" },
  { value: "techs", label: "Techs" },
] as const;

/** The words under the tabs, Workiz's own (pg_dispatch_wz_02 / _11). */
const DESCRIPTION: Record<MapTab, string> = {
  jobs: "See jobs on the map, color-coded by technician",
  techs: "See where your team is right now with live tracking",
};

/**
 * One "Show leads"-style row (Sidebar-module toggleContainer): 15px under
 * what is above it, 10px in, the words 14px semibold ink 5px further in, the
 * small toggle at the right, a #dfe2e3 rule 12px under.
 */
export function MapToggleRow({
  label,
  checked,
  onCheckedChange,
}: {
  label: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <div className="mt-[15px] flex justify-between border-b border-border px-2.5 pb-3">
      <span className="ml-[5px] text-sm leading-4 font-semibold tracking-[0.4px] text-foreground">{label}</span>
      <WzMiniToggle label={label} checked={checked} onCheckedChange={onCheckedChange} />
    </div>
  );
}

/**
 * The Map's 386px sidebar (Sidebar-module, pg_dispatch_wz_02_loaded): the
 * Search box with "Filter by" beside it (Jobs only), the "Jobs | Techs"
 * switch, then the scrolling list — the tab's description, "Found …" with
 * "⟳ Refresh", the display toggles (Jobs) and the cards.
 */
export function MapSidebar({
  tab,
  onTab,
  showTabs,
  search,
  onSearch,
  onSearchEnter,
  onFilters,
  filtersPanel,
  found,
  onRefresh,
  refreshing,
  refreshTitle,
  toggles,
  children,
}: {
  tab: MapTab;
  onTab: (tab: MapTab) => void;
  /** Without technicians.view there is only the jobs side to show. */
  showTabs: boolean;
  search: string;
  onSearch: (value: string) => void;
  onSearchEnter: () => void;
  onFilters: () => void;
  /** The Filters panel, when open — it takes the sidebar's place. */
  filtersPanel?: ReactNode;
  /** "Found 265 out of 530 open jobs" / "Found 29 users". */
  found: string;
  onRefresh: () => void;
  refreshing: boolean;
  refreshTitle?: string;
  toggles?: ReactNode;
  children: ReactNode;
}) {
  return (
    <aside data-testid="map-sidebar" className="flex w-[386px] shrink-0 flex-col tracking-[0.4px]">
      {filtersPanel ?? (
        <>
          <div className="flex items-center justify-between border-b border-border">
            <div className="min-w-0 flex-1 p-3">
              <WzSearchBox
                value={search}
                onChange={onSearch}
                onKeyDown={(e) => {
                  if (e.key === "Enter") onSearchEnter();
                }}
                className="w-full"
              />
            </div>
            {tab === "jobs" ? (
              <div className="pr-2.5">
                <Button variant="ghost" size="icon" aria-label="Filter by" title="Filter by" onClick={onFilters}>
                  <Settings2 className="size-5" strokeWidth={1.6} />
                </Button>
              </div>
            ) : null}
          </div>
          <div className="flex min-h-0 flex-1 flex-col border-b border-border px-[9px] py-3">
            {showTabs ? <WzSwitchTabs tabs={TABS} value={tab} onChange={onTab} aria-label="Show" /> : null}
            <div className={cn("-mx-[9px] min-h-0 flex-1 overflow-y-auto", showTabs && "mt-3")}>
              <p className="border-b border-border px-4 pt-1 pb-3 text-sm leading-[21px] text-wz-slate">{DESCRIPTION[tab]}</p>
              <div className="flex items-center justify-between border-b border-border px-4 py-3 text-wz-slate">
                <p className="text-[13px] leading-[19px] font-medium">{found}</p>
                <button
                  type="button"
                  onClick={onRefresh}
                  disabled={refreshing}
                  title={refreshTitle}
                  className="flex cursor-pointer items-center gap-2 outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:cursor-default"
                >
                  <RefreshCw className={cn("size-6", refreshing && "animate-spin")} strokeWidth={1.4} />
                  <span className="text-[13px] leading-[19px] font-medium text-foreground">Refresh</span>
                </button>
              </div>
              {tab === "jobs" ? toggles : null}
              {children}
            </div>
          </div>
        </>
      )}
    </aside>
  );
}
