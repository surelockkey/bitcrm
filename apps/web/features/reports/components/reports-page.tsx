"use client";

import { NoAccess } from "@/features/clients/components/contacts-page";
import { useDenied, usePermissions } from "@/features/auth/use-permissions";
import { WzHubCard, WzHubCardSkeleton, WzHubGrid } from "@/components/workiz/hub-cards";
import { WzTabBar } from "@/components/workiz/tab-bar";
import { hubTiles, REPORT_TILES } from "../hub/report-tiles";

/**
 * Workiz's "Workiz reports" tab, ours by name — as Workiz Phone is our
 * "BitCRM Phone". BitCRM has no custom reports, so there is no "Custom
 * reports" tab beside it and no "Create report" buttons.
 */
const TAB = { value: "bitcrm", label: "BitCRM reports" } as const;

/**
 * The Reports hub as Workiz draws it (`/root/_reports?view=workiz-reports`,
 * rep_hub_wz_01_default): the 25px "Reports" heading 30px under the
 * breadcrumb, the small tab row, and a card per report on Developr's
 * three-column grid — only the reports BitCRM has a page for, in Workiz's
 * order (`hubTiles`).
 *
 * `built` = the report routes that have a page in this build (the server page
 * reads it). Left out, every route counts as built.
 */
export function ReportsPage({ built }: { built?: readonly string[] }) {
  const denied = useDenied();
  // Until the role is read nothing is refused, so every card was drawn and
  // the ones the role may not open were taken out a moment later — the cards
  // after them moved up a place. The cards wait for the role.
  const { isLoading } = usePermissions();

  if (denied("reports", "view")) return <NoAccess entity="reports" />;

  const tiles = hubTiles({ built, denied });

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      {/* Workiz's header row is 40px (its Create report buttons); the title
          sits at its top. */}
      <div className="mt-[30px] flex h-10 shrink-0 items-start px-5">
        <h1 className="text-[25px] leading-8 font-medium text-foreground">Reports</h1>
      </div>
      {/* 4px under the header; the tab is 1px left of the content as in Workiz. */}
      <WzTabBar aria-label="Reports" tabs={[TAB]} value={TAB.value} onValueChange={() => {}} className="mt-1 -ml-px shrink-0" />

      <div role="tabpanel" aria-label={TAB.label}>
        {isLoading ? (
          <div role="status" aria-label="Loading reports">
            <WzHubGrid aria-label="Loading reports">
              {REPORT_TILES.filter((t) => t.href && (built ? built.includes(t.href) : true)).map((t) => (
                <WzHubCardSkeleton key={t.name} />
              ))}
            </WzHubGrid>
          </div>
        ) : (
          <WzHubGrid aria-label="Reports">
            {tiles.map((tile) => (
              <WzHubCard key={tile.name} href={tile.href!} title={tile.name} icon={tile.icon} />
            ))}
          </WzHubGrid>
        )}
      </div>
    </div>
  );
}
