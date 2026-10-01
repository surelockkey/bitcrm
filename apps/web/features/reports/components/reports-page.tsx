"use client";

import { useId } from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { toast } from "sonner";
import { NoAccess } from "@/features/clients/components/contacts-page";
import { useDenied } from "@/features/auth/use-permissions";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { REPORT_TILES, type ReportTile } from "../hub/report-tiles";

export { REPORT_TILES };

/**
 * The Reports hub, laid out like the rest of BitCRM: the page title, then one
 * tile per kept report (see `REPORT_TILES`) in the Settings list's shape — an
 * icon, the name, a line on what it answers.
 *
 * `built` = the report routes that have a page in this build (the server page
 * reads it); a tile opens only those. Left out, every route counts as built.
 */
export function ReportsPage({ built }: { built?: readonly string[] }) {
  const denied = useDenied();

  if (denied("reports", "view")) return <NoAccess entity="reports" />;

  // Workiz leaves out the reports a role may not open; so do we.
  const tiles = REPORT_TILES.filter((t) => !(t.requires ?? []).some(([resource, action]) => denied(resource, action)));
  const isBuilt = (href: string) => (built ? built.includes(href) : true);

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <div className="border-b px-6 pt-4 pb-4">
        <h1 className="text-lg font-semibold tracking-tight">Reports</h1>
      </div>

      <ul aria-label="Reports" className="grid grid-cols-1 gap-3 p-6 md:grid-cols-2 xl:grid-cols-3">
        {tiles.map((tile) => (
          <li key={tile.name} className="min-w-0">
            <ReportTileCard tile={tile} built={tile.href !== undefined && isBuilt(tile.href)} />
          </li>
        ))}
      </ul>
    </div>
  );
}

const TILE = "flex w-full items-center gap-3 rounded-lg border bg-card px-4 py-3.5 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring";

/**
 * One report tile. A built report is a link that opens it. A report BitCRM
 * doesn't have yet is the same tile, dimmed, with a badge saying why, and it
 * doesn't navigate — clicking it says so.
 */
function ReportTileCard({ tile, built }: { tile: ReportTile; built: boolean }) {
  const { name, description, icon: Icon, href } = tile;
  // The tile is named by the report; the line under it describes it.
  const describedBy = useId();

  const body = (
    <>
      <span className="flex size-9 shrink-0 items-center justify-center rounded-md border bg-muted/40">
        <Icon className="size-4" aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span data-slot="report-name" className="truncate text-sm font-medium">
            {name}
          </span>
          {!built && (
            <Badge variant="secondary" className="shrink-0">
              {href !== undefined ? "Coming soon" : "Not in BitCRM"}
            </Badge>
          )}
        </span>
        <span id={describedBy} className="block truncate text-sm text-muted-foreground">
          {description}
        </span>
      </span>
    </>
  );

  if (built && href) {
    return (
      <Link href={href} aria-label={name} aria-describedby={describedBy} className={cn(TILE, "hover:bg-muted/50")}>
        {body}
        <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      </Link>
    );
  }

  // `href` set = the report's page is in an open PR; none = nobody builds it.
  const why = href !== undefined ? `${name} is on the way — it isn't in BitCRM yet.` : `${name} isn't in BitCRM.`;
  return (
    <button
      type="button"
      aria-label={name}
      aria-describedby={describedBy}
      aria-disabled="true"
      title={why}
      onClick={() => toast.info(why)}
      className={cn(TILE, "cursor-default opacity-60")}
    >
      {body}
    </button>
  );
}
