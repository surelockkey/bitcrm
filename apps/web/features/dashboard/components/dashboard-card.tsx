"use client";

import { useState, type ReactNode } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { WzWidget, type WzWidgetMenuItem } from "@/components/workiz/widget";
import { usePermissions } from "@/features/auth/use-permissions";
import { cn } from "@/lib/utils";
import { updatedAtLabel } from "../jobs-by-status";
import { ManageWidgetPermissionsDialog } from "./manage-widget-permissions-dialog";

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
 * A dashboard widget in Workiz's frame (`WzWidget`), wired to its query: the
 * refresh arrows refetch, the kebab offers "Manage Permissions" (only to
 * somebody who edits roles — the dialog writes the permission matrix) and
 * "Remove" (off this person's dashboard), "updated …" is stamped only where
 * Workiz stamps it, and the body is a function of the data, so it only ever
 * renders with an answer in hand.
 */
export function DashboardCard<T>({
  title,
  help,
  action,
  query,
  stamped = false,
  viewAll,
  onRemove,
  skeletonClassName = "h-40",
  className,
  bodyClassName,
  children,
}: {
  title: string;
  /** Workiz's `?` text; only the widgets Workiz explains have one. */
  help?: string;
  /** The widget's grant under `dashboard`, e.g. `view_top_sources`. */
  action: string;
  query: WidgetQuery<T>;
  /** "updated 3:06 PM" — on the widgets Workiz stamps (the snapshots). */
  stamped?: boolean;
  viewAll?: { href: string; underline?: boolean };
  /** Take the widget off this person's dashboard. */
  onRemove?: () => void;
  skeletonClassName?: string;
  className?: string;
  bodyClassName?: string;
  children: (data: T) => ReactNode;
}) {
  const { can } = usePermissions();
  const [managing, setManaging] = useState(false);
  // A snapshot says when it was computed — the nightly run's 3 AM, or the
  // last refresh. Anything read live falls back to when it arrived.
  const computedAt = (query.data as { computedAt?: string } | undefined)?.computedAt;
  const updatedAt = computedAt ? Date.parse(computedAt) : query.dataUpdatedAt;

  const menu: WzWidgetMenuItem[] = [
    ...(can("roles", "edit") ? [{ key: "manage", label: "Manage Permissions", onSelect: () => setManaging(true) }] : []),
    ...(onRemove ? [{ key: "remove", label: "Remove", onSelect: onRemove }] : []),
  ];

  return (
    <WzWidget
      className={className}
      bodyClassName={bodyClassName}
      title={title}
      help={help}
      updatedAt={stamped && updatedAt ? updatedAtLabel(new Date(updatedAt)) : undefined}
      refreshing={query.isFetching && !query.isLoading}
      onRefresh={() => void query.refetch()}
      menu={menu}
      viewAll={viewAll}
    >
      {query.isLoading ? (
        <Skeleton data-testid="widget-skeleton" className={cn("w-full", skeletonClassName)} />
      ) : query.isError || query.data == null ? (
        <p className="pt-10 text-center text-sm text-wz-dash-label">Couldn&apos;t load this widget.</p>
      ) : (
        children(query.data)
      )}
      <ManageWidgetPermissionsDialog open={managing} onOpenChange={setManaging} action={action} label={title} />
    </WzWidget>
  );
}
