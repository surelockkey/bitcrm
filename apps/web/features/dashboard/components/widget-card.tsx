"use client";

import { CircleHelp, MoreVertical, RefreshCw } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/**
 * The frame every dashboard widget sits in: a title, when its numbers were
 * last fetched, and the three controls Workiz puts in that corner — what this
 * widget means, fetch it again, and the rest.
 *
 * The refresh button spins only while a refetch is in flight, never on the
 * first load: the body already shows a skeleton then, and two things moving at
 * once reads as an error.
 */
export function WidgetCard({
  title,
  help,
  updatedAt,
  isRefreshing,
  onRefresh,
  menu,
  toolbar,
  className,
  children,
}: {
  title: string;
  /** One sentence on what the widget counts, behind the `?`. */
  help: string;
  /** Absent until the first answer arrives. */
  updatedAt?: string;
  isRefreshing?: boolean;
  onRefresh?: () => void;
  /** The kebab's items; the button is there but inert when nothing is passed. */
  menu?: ReactNode;
  /** The widget's own controls — a range picker, say — beside the title row. */
  toolbar?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Card className={cn("gap-0 overflow-hidden py-0", className)}>
      <div className="flex items-center gap-2 border-b px-5 py-3.5">
        {/* The title never wraps; in a one-column card it is "updated …" that
            gives way, truncating before it pushes the title onto two lines. */}
        <h2 className="shrink-0 whitespace-nowrap text-base font-semibold tracking-tight">{title}</h2>
        {updatedAt ? (
          <span className="min-w-0 truncate text-xs whitespace-nowrap text-muted-foreground">
            updated {updatedAt}
          </span>
        ) : null}

        <div className="ml-auto flex shrink-0 items-center gap-0.5">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label={`About ${title}`}>
                <CircleHelp />
              </Button>
            </TooltipTrigger>
            <TooltipContent className="max-w-64">{help}</TooltipContent>
          </Tooltip>

          {onRefresh ? (
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={`Refresh ${title}`}
              disabled={isRefreshing}
              onClick={onRefresh}
            >
              <RefreshCw className={cn(isRefreshing && "animate-spin")} />
            </Button>
          ) : null}

          {menu ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon-sm" aria-label={`${title} options`}>
                  <MoreVertical />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">{menu}</DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <Button variant="ghost" size="icon-sm" aria-label={`${title} options`} disabled>
              <MoreVertical />
            </Button>
          )}
        </div>
      </div>

      {toolbar ? (
        <div className="flex flex-wrap items-center gap-3 px-5 pt-4">{toolbar}</div>
      ) : null}

      <div className="px-5 pt-4 pb-5">{children}</div>
    </Card>
  );
}
