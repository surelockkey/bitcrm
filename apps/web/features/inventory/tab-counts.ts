"use client";

import { useQuery } from "@tanstack/react-query";
import { InventoryStatus, UserStatus } from "@bitcrm/types";
import { queryKeys } from "@/lib/query-keys";
import { settled } from "@/lib/use-page-ready";
import { countUsers, type UserFilter } from "@/features/users/api";
import { usePermissions } from "@/features/auth/use-permissions";
import { useProductsCount } from "./products/hooks";
import { useWarehousesCount } from "./warehouses/hooks";
import { useContainersCount } from "./containers/hooks";
import { useContainerTemplates } from "./templates/hooks";
import { useTransfersCount } from "./transfers/hooks";
import type { ProductFilter } from "./products/lib";

export type InventoryTabId = "items" | "warehouses" | "containers" | "user-containers" | "templates" | "transfers";

/**
 * Each tab's list as it opens — its counter is the total its own pager
 * reads, under the very same query key, so the counters cost no request the
 * tabs would not make anyway.
 */
export const INVENTORY_TAB_DEFAULTS = {
  items: { manageStock: true, status: InventoryStatus.ACTIVE } satisfies ProductFilter,
  warehouses: { status: InventoryStatus.ACTIVE },
  containers: {},
  users: { status: UserStatus.ACTIVE } satisfies UserFilter,
  transfers: {},
} as const;

/** One tab's count: its total once answered; `settled` also when it failed or was never asked. */
export interface TabCountSource {
  total?: number | null;
  settled: boolean;
}

/**
 * The counters Workiz prints beside its Inventory tabs ("Inventory 99+",
 * "Locations 94"): a tab gets one when its count answered. `settled` once
 * every count is in — the tab row draws them together, with the page.
 */
export function inventoryTabCounts(sources: Partial<Record<InventoryTabId, TabCountSource>>): {
  counts: Partial<Record<InventoryTabId, number>>;
  settled: boolean;
} {
  const counts: Partial<Record<InventoryTabId, number>> = {};
  let all = true;
  for (const [tab, source] of Object.entries(sources) as [InventoryTabId, TabCountSource][]) {
    if (!source.settled) all = false;
    if (typeof source.total === "number") counts[tab] = source.total;
  }
  return { counts, settled: all };
}

/**
 * Every tab's counter, each asked only of a reader allowed that tab — read once,
 * by the Inventory frame, whose pages wait for it inside their one-load gate,
 * so the counters and the page arrive in the same frame.
 */
export function useInventoryTabCounts() {
  const { can, isLoading } = usePermissions();
  const allowed = (resource: Parameters<typeof can>[0]) => !isLoading && can(resource);

  const items = useProductsCount(INVENTORY_TAB_DEFAULTS.items, allowed("products"));
  const warehouses = useWarehousesCount(INVENTORY_TAB_DEFAULTS.warehouses, allowed("warehouses"));
  const containers = useContainersCount(INVENTORY_TAB_DEFAULTS.containers, allowed("containers"));
  // The User locations tab lists the active users directory (its own read, same key).
  const users = useQuery({
    queryKey: queryKeys.users.count(INVENTORY_TAB_DEFAULTS.users),
    queryFn: () => countUsers(INVENTORY_TAB_DEFAULTS.users),
    enabled: allowed("containers") && allowed("users"),
    staleTime: 30_000,
  });
  const templates = useContainerTemplates(InventoryStatus.ACTIVE, allowed("containers"));
  const transfers = useTransfersCount(INVENTORY_TAB_DEFAULTS.transfers, allowed("transfers"));

  const view = inventoryTabCounts({
    items: { total: items.data?.total, settled: settled(items) },
    warehouses: { total: warehouses.data?.total, settled: settled(warehouses) },
    containers: { total: containers.data?.total, settled: settled(containers) },
    "user-containers": { total: users.data?.total, settled: settled(users) },
    templates: { total: templates.data?.length, settled: settled(templates) },
    transfers: { total: transfers.data?.total, settled: settled(transfers) },
  });
  return { ...view, settled: !isLoading && view.settled };
}
