"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { isFieldTeamMember } from "@bitcrm/types";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useDebouncedValue } from "@/lib/use-debounced-value";
import { usePageSize } from "@/lib/paging/use-page-size";
import { useDenied, usePermissions } from "@/features/auth/use-permissions";
import { NoAccess } from "@/features/clients/components/contacts-page";
import { useUserMap } from "@/features/deals/hooks";
import { personName } from "@/features/deals/person-name";
import { useBrands, useItemCategories } from "@/features/inventory/products/hooks";
import { useAllLocations } from "@/features/inventory/stock/hooks";
import { REPORT_TABS, parseReportState, reportHref, type ReportState } from "../params";
import type { ReportQuery, ReportTab } from "../types";
import { DateRangeControl } from "./date-range-control";
import { FilterResults, type FilterGroup } from "./filter-results";
import { LogPanel, REPORT_PAGE_SIZES, ReturnsPanel, UsagePanel, type PanelProps } from "./report-panels";

/** The header and tabs, as the first HTML shows them before the URL is read. */
export function InventoryUsageReportFallback() {
  return (
    <div className="flex min-w-0 flex-1 flex-col" aria-busy>
      <div className="flex items-center gap-2 border-b px-6 py-4">
        <span className="size-9" />
        <h1 className="text-lg font-semibold tracking-tight">Inventory Usage</h1>
      </div>
      <div className="flex gap-1 border-b px-6 pt-2 pb-[5px]">
        {REPORT_TABS.map((t) => (
          <span key={t.value} className="px-3 py-0.5 text-sm font-medium text-foreground/60">
            {t.label}
          </span>
        ))}
      </div>
    </div>
  );
}

const byLabel = (a: { label: string }, b: { label: string }) => a.label.localeCompare(b.label);

/** The four "Filter results" groups, from the catalogs the reader may see. */
function useFilterGroups(can: (resource: "product_categories" | "brands") => boolean): FilterGroup[] {
  const { users } = useUserMap();
  const locations = useAllLocations();
  const categories = useItemCategories(can("product_categories"));
  const brands = useBrands(can("brands"));

  return useMemo(() => {
    // Workiz's TECHS: the field team. A person without the flag decides by role.
    const techs = users
      .filter((u) => isFieldTeamMember(u as unknown as Parameters<typeof isFieldTeamMember>[0]))
      .map((u) => ({ value: u.id, label: personName(u) ?? "" }))
      .filter((o) => o.label)
      .sort(byLabel);
    return [
      { key: "techIds", heading: "Techs", options: techs },
      {
        key: "locationIds",
        heading: "Locations",
        options: locations.data.map((l) => ({ value: l.id, label: l.name })),
      },
      {
        key: "categories",
        heading: "Category",
        options: [...new Set((categories.data ?? []).map((c) => c.name))]
          .map((name) => ({ value: name, label: name }))
          .sort(byLabel),
      },
      {
        key: "brandIds",
        heading: "Brand",
        options: (brands.data ?? []).map((b) => ({ value: b.id, label: b.name })).sort(byLabel),
      },
    ];
  }, [users, locations.data, categories.data, brands.data]);
}

const PANELS: Record<ReportTab, (props: PanelProps) => React.ReactNode> = {
  usage: UsagePanel,
  returns: ReturnsPanel,
  log: LogPanel,
};

/**
 * Workiz's Inventory Usage report: what went onto jobs (by the job's date),
 * what was returned or removed from a location, and every inventory action —
 * Workiz's history included, which the import carried over.
 *
 * The tab, the dates and the filters live in the URL; each tab pages on the
 * server, its Totals come from the server's summary of the whole window, and
 * money shows only with `financials.view`.
 *
 * `today` pins the presets in tests; the page otherwise reads the UTC day, as
 * the other reports do.
 */
export function InventoryUsageReportPage({ today: fixedToday }: { today?: string }) {
  const denied = useDenied();
  const { can, isLoading: permsLoading } = usePermissions();
  const router = useRouter();
  const params = useSearchParams();
  const [today] = useState(() => fixedToday ?? new Date().toISOString().slice(0, 10));
  const state = parseReportState(params, today);

  const [search, setSearch] = useState("");
  const term = useDebouncedValue(search.trim(), 300);
  const [pageSize, setPageSize] = usePageSize("inventory-usage-report", {
    sizes: REPORT_PAGE_SIZES,
    fallback: 10,
  });
  const groups = useFilterGroups((resource) => can(resource, "view"));

  if (denied("reports", "view")) return <NoAccess entity="reports" />;

  const go = (patch: Partial<ReportState>) =>
    router.replace(reportHref({ ...state, ...patch }), { scroll: false });

  const query: ReportQuery = { from: state.from, to: state.to, filters: state.filters, search: term };
  const Panel = PANELS[state.tab];

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <div className="flex items-center gap-2 border-b px-6 py-4">
        <Button asChild variant="ghost" size="icon" aria-label="Back to reports">
          <Link href="/reports">
            <ArrowLeft className="size-4" />
          </Link>
        </Button>
        <h1 className="text-lg font-semibold tracking-tight">Inventory Usage</h1>
      </div>

      <Tabs value={state.tab} onValueChange={(v) => go({ tab: v as ReportTab })} className="border-b px-6 pt-2">
        <TabsList variant="line" aria-label="Report">
          {REPORT_TABS.map((t) => (
            <TabsTrigger key={t.value} value={t.value} className="px-3">
              {t.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <div className="flex min-w-0 flex-col gap-3 px-6 pt-4 sm:flex-row sm:items-start">
        <div className="min-w-0 flex-1">
          <FilterResults groups={groups} value={state.filters} onChange={(filters) => go({ filters })} />
        </div>
        <DateRangeControl
          preset={state.preset}
          from={state.from}
          to={state.to}
          onPreset={(preset) => go({ preset })}
          onDays={(days) => go({ preset: "custom", ...days })}
        />
      </div>

      <div className="min-w-0 px-6 pb-6">
        {/* Keyed by tab: each tab's rows are their own, and the last tab's
            are never held on screen as the next one's placeholder. */}
        <Panel
          key={state.tab}
          query={query}
          search={search}
          onSearch={setSearch}
          pageSize={pageSize}
          onPageSize={setPageSize}
          money={permsLoading || can("financials", "view")}
          permsLoading={permsLoading}
          canDeals={can("deals", "view")}
        />
      </div>
    </div>
  );
}
