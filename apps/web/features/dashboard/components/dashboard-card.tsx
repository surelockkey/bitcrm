"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { usePermissions } from "@/features/auth/use-permissions";
import { cn } from "@/lib/utils";
import { RANGE_PRESETS, updatedAtLabel, type DashboardRange } from "../jobs-by-status";
import { ManageWidgetPermissionsDialog } from "./manage-widget-permissions-dialog";
import { WidgetCard } from "./widget-card";

/** The slice of a react-query result a widget frame reads. */
export interface WidgetQuery<T> {
  data: T | undefined;
  isLoading: boolean;
  isError: boolean;
  isFetching: boolean;
  dataUpdatedAt: number;
  refetch: () => unknown;
}

/**
 * Everything a dashboard widget has in common, as Workiz draws it: the
 * `WidgetCard` frame with "updated 3:08 AM" and refresh, the kebab with "who
 * can see this widget", the widget's own "Last N Days" picker, the first-load
 * skeleton and the failure line, and "View All" underneath.
 *
 * The body is a function of the data, so it only ever renders with an answer
 * in hand.
 */
export function DashboardCard<T>({
  title,
  help,
  action,
  query,
  range,
  onRangeChange,
  viewAll,
  skeletonClassName = "h-40",
  className,
  children,
}: {
  title: string;
  help: string;
  /** The widget's grant under `dashboard`, e.g. `view_top_sources`. */
  action: string;
  query: WidgetQuery<T>;
  /** Present only on a widget that reads a window. */
  range?: DashboardRange;
  onRangeChange?: (range: DashboardRange) => void;
  /** Where "View All" goes, when the widget has a fuller screen behind it. */
  viewAll?: string;
  skeletonClassName?: string;
  className?: string;
  children: (data: T) => ReactNode;
}) {
  const { can } = usePermissions();
  const [managing, setManaging] = useState(false);

  return (
    <WidgetCard
      className={className}
      title={title}
      help={help}
      updatedAt={query.dataUpdatedAt ? updatedAtLabel(new Date(query.dataUpdatedAt)) : undefined}
      isRefreshing={query.isFetching && !query.isLoading}
      onRefresh={() => void query.refetch()}
      menu={
        // Only somebody who can edit roles is offered the audience — the
        // dialog writes the permission matrix, and the server would refuse
        // anyone else halfway through.
        can("roles", "edit") ? (
          <DropdownMenuItem onSelect={() => setManaging(true)}>Manage permissions</DropdownMenuItem>
        ) : undefined
      }
      toolbar={
        range !== undefined && onRangeChange ? (
          <div className="ml-auto">
            <Select value={String(range)} onValueChange={(v) => onRangeChange(Number(v) as DashboardRange)}>
              <SelectTrigger size="sm" className="w-38" aria-label="Range">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {RANGE_PRESETS.map((p) => (
                  <SelectItem key={p.days} value={String(p.days)}>
                    {p.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : undefined
      }
    >
      {query.isLoading ? (
        <Skeleton data-testid="widget-skeleton" className={cn("w-full", skeletonClassName)} />
      ) : query.isError || query.data === undefined ? (
        <p className="py-10 text-center text-sm text-muted-foreground">Couldn&apos;t load this widget.</p>
      ) : (
        children(query.data)
      )}
      {viewAll ? (
        <Link href={viewAll} className="mt-3 inline-block text-sm text-brand underline-offset-2 hover:underline">
          View All
        </Link>
      ) : null}
      <ManageWidgetPermissionsDialog open={managing} onOpenChange={setManaging} action={action} label={title} />
    </WidgetCard>
  );
}
