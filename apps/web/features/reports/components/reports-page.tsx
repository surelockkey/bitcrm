"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight, FileChartPie } from "lucide-react";
import { Tabs as TabsPrimitive } from "radix-ui";
import { toast } from "sonner";
import { NoAccess } from "@/features/clients/components/contacts-page";
import { useDenied } from "@/features/auth/use-permissions";
import { cn } from "@/lib/utils";
import { REPORT_TILES, type ReportTile } from "../hub/report-tiles";
import { workizFont } from "../hub/workiz-font";

export { REPORT_TILES };

/** Workiz's two tabs. Switching is page state: the address stays `/reports`, as Workiz's does. */
const TABS = [
  { value: "workiz", label: "Workiz reports" },
  { value: "custom", label: "Custom reports" },
] as const;
type TabValue = (typeof TABS)[number]["value"];

/*
 * Workiz's measurements (app.workiz.com/root/_reports, 2026-09-30). Colours
 * that the theme already carries are used through it: #3b4b52 is
 * `foreground`, #f3f6f7 is `sidebar-accent`.
 */
const LINE = "border-[#c4c4c4]"; // tab bar and tab list rules
const SUBTLE = "text-[#566d76]"; // unselected tab, descriptions
const ICON = "text-[#404040]"; // tile icons
const TILE_SHADOW = "shadow-[0_1px_3px_0_rgba(0,0,0,0.16),0_2px_10px_0_rgba(0,0,0,0.12)]";
const TILE_LIFT = "hover:shadow-[0_12px_12px_-8px_rgba(0,0,0,0.4)]";

/**
 * Reports, as Workiz lays it out: the "Workiz reports" tab — one tile per
 * report, Workiz's 23 in Workiz's order — and "Custom reports".
 *
 * `built` = the report routes that have a page in this build (the server page
 * reads it); a tile opens only those. Left out, every route counts as built.
 */
export function ReportsPage({ built }: { built?: readonly string[] }) {
  const denied = useDenied();
  const [tab, setTab] = useState<TabValue>("workiz");
  // Phones get Workiz's tab navigator: the open tab under a "Back" bar, and
  // Back shows the list of tabs.
  const [choosingTab, setChoosingTab] = useState(false);

  if (denied("reports", "view")) return <NoAccess entity="reports" />;

  // Workiz leaves out the reports a role may not open.
  const tiles = REPORT_TILES.filter((t) => !(t.requires ?? []).some(([resource, action]) => denied(resource, action)));
  const isBuilt = (href: string) => (built ? built.includes(href) : true);
  const current = TABS.find((t) => t.value === tab) ?? TABS[0];

  return (
    <div
      className={cn(
        workizFont.className,
        "flex min-h-0 flex-1 flex-col overflow-y-auto bg-background tracking-[0.4px] text-[#404040]",
      )}
    >
      <div className="mx-5 mt-4 flex min-h-10 items-start justify-between max-md:mb-4">
        <h1 className="text-[25px] font-medium leading-8 text-foreground">Reports</h1>
      </div>

      <TabsPrimitive.Root value={tab} onValueChange={(v) => setTab(v as TabValue)} className="flex flex-col">
        {/* Tablet and up: Workiz's tab strip. */}
        <TabsPrimitive.List aria-label="Reports" className={cn("mt-1 hidden border-b md:flex", LINE)}>
          {TABS.map((t) => (
            <TabsPrimitive.Trigger
              key={t.value}
              value={t.value}
              className={cn(
                "group -mb-px -ml-px px-5 pt-2.5 pb-[9px] outline-none focus-visible:ring-2 focus-visible:ring-ring",
                "data-[state=active]:border-b-2 data-[state=active]:border-foreground data-[state=active]:pb-[7px]",
                "data-[state=inactive]:hover:rounded-t-lg data-[state=inactive]:hover:border-b data-[state=inactive]:hover:border-[#c4c4c4] data-[state=inactive]:hover:bg-sidebar-accent data-[state=inactive]:hover:pb-2",
              )}
            >
              <span
                className={cn(
                  "flex h-5 items-center text-[13px] font-medium leading-[19px]",
                  SUBTLE,
                  "group-data-[state=active]:font-semibold group-data-[state=active]:text-foreground",
                )}
              >
                {t.label}
              </span>
            </TabsPrimitive.Trigger>
          ))}
        </TabsPrimitive.List>

        {/* Phones: Workiz's tab navigator. */}
        <div className="md:hidden">
          {choosingTab ? (
            <ul aria-label="Report tabs" className="w-[calc(100%-20px)]">
              {TABS.map((t, i) => (
                <li key={t.value}>
                  <button
                    type="button"
                    onClick={() => {
                      setTab(t.value);
                      setChoosingTab(false);
                    }}
                    className={cn("flex w-full items-center border-b py-5 pl-5 text-left", LINE, i === 0 && "border-t")}
                  >
                    <span className={cn("flex h-5 flex-1 items-center justify-center text-[13px] font-medium leading-[19px]", SUBTLE)}>
                      {t.label}
                    </span>
                    <ChevronRight className="mr-5 size-[22px] text-[#6d6d6d]" strokeWidth={1.25} aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <button
              type="button"
              onClick={() => setChoosingTab(true)}
              aria-label={`Back to the report tabs (${current.label} is open)`}
              className={cn(
                "grid w-full grid-cols-[1fr_2fr_1fr] items-center rounded-t-md border-y pt-2.5 pb-[9px] text-left text-sm leading-4 text-[#6d6d6d]",
                LINE,
              )}
            >
              <span className="flex items-center gap-2.5">
                <ChevronLeft className="size-[22px]" strokeWidth={1.25} aria-hidden />
                Back
              </span>
              <span className="text-center text-lg leading-4 text-[#404040]">{current.label}</span>
              <span />
            </button>
          )}
        </div>

        <TabsPrimitive.Content value="workiz" className={cn("outline-none", choosingTab && "max-md:hidden")}>
          <div className="grid grid-cols-1 gap-x-[2.3%] gap-y-2.5 p-5 min-[35.6875rem]:gap-y-[25px] md:grid-cols-2 min-[75rem]:grid-cols-3">
            {tiles.map((tile) => (
              <ReportTileCard key={tile.name} tile={tile} built={tile.href !== undefined && isBuilt(tile.href)} />
            ))}
          </div>
        </TabsPrimitive.Content>

        <TabsPrimitive.Content value="custom" className={cn("outline-none", choosingTab && "max-md:hidden")}>
          <CustomReports />
        </TabsPrimitive.Content>
      </TabsPrimitive.Root>
    </div>
  );
}

/**
 * One Workiz report card: a white box with a dark 3px left rule, the name on
 * the left and a 30px line icon on the right; it lifts on hover. A report
 * BitCRM doesn't have yet is the same card, greyed, with a label saying why,
 * and it doesn't navigate.
 */
function ReportTileCard({ tile, built }: { tile: ReportTile; built: boolean }) {
  const { name, icon: Icon, href } = tile;

  if (built && href) {
    return (
      <Link
        href={href}
        className={cn(
          "block rounded-[1px] outline-none transition-shadow duration-300 focus-visible:ring-2 focus-visible:ring-ring",
          TILE_LIFT,
        )}
      >
        <div
          className={cn(
            "flex h-[46px] items-center justify-between gap-2 rounded-[1px] border-l-[3px] border-foreground bg-card pr-5 pl-[15px]",
            TILE_SHADOW,
          )}
        >
          <span data-slot="report-name" className="truncate text-sm font-medium leading-4 text-foreground md:text-base">
            {name}
          </span>
          <Icon className={cn("size-[30px] shrink-0", ICON)} strokeWidth={1.25} aria-hidden />
        </div>
      </Link>
    );
  }

  // `href` set = the report's page is in an open PR; none = nobody builds it.
  const coming = href !== undefined;
  const why = coming
    ? `${name} is on the way — it isn't in BitCRM yet.`
    : `${name} isn't in BitCRM.`;
  return (
    <button
      type="button"
      aria-disabled="true"
      title={why}
      onClick={() => toast.info(why)}
      className="block w-full cursor-default rounded-[1px] text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <div
        className={cn(
          "flex h-[46px] items-center justify-between gap-2 rounded-[1px] border-l-[3px] border-[#9ea6aa] bg-card pr-5 pl-[15px]",
          TILE_SHADOW,
        )}
      >
        {/* The name wins the room; on a narrow card the label gives way. */}
        <span className="flex min-w-0 items-center gap-2">
          <span data-slot="report-name" className={cn("shrink-0 text-sm font-medium leading-4 md:text-base", SUBTLE)}>
            {name}
          </span>
          <span className="block h-5 min-w-0 truncate rounded-chip bg-[#768287] px-2 text-[11px] font-medium leading-5 text-white">
            {coming ? "Coming soon" : "Not in BitCRM"}
          </span>
        </span>
        <Icon className="size-[30px] shrink-0 text-[#9ea6aa]" strokeWidth={1.25} aria-hidden />
      </div>
    </button>
  );
}

/**
 * Workiz's "Custom reports" tab with nothing saved: the section heading, its
 * line of text, and the empty state. BitCRM can't build custom reports, so
 * Workiz's "+ Add custom report" (and the header's Create buttons) are left
 * out; the empty state says so instead.
 */
function CustomReports() {
  return (
    <div>
      <div className="mt-[25px] ml-5 flex items-center">
        <h2 className="mr-2 text-sm font-semibold leading-[21px] text-foreground">Custom reports</h2>
      </div>
      <p className={cn("mx-5 mt-2 text-[13px] leading-[19px]", SUBTLE)}>Your saved custom reports appear here.</p>
      <div className="flex min-h-[max(35vh,calc(100vh-450px))] items-center justify-center p-5">
        <div className="flex h-[200px] w-full flex-col items-center justify-center gap-2.5 text-center text-sm font-semibold text-foreground">
          <span className="flex size-[124px] items-center justify-center rounded-full bg-sidebar-accent" aria-hidden>
            <FileChartPie className="size-14" strokeWidth={1.25} />
          </span>
          <span>No custom reports found</span>
          <span className={cn("text-[13px] font-normal leading-[19px]", SUBTLE)}>
            Creating custom reports isn&apos;t available in BitCRM.
          </span>
        </div>
      </div>
    </div>
  );
}
