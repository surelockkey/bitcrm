"use client";

import { usePathname } from "next/navigation";
import type { Resource } from "@bitcrm/types";
import { WzTabLinks } from "@/components/workiz/page-parts";
import { usePermissions } from "@/features/auth/use-permissions";
import type { InventoryTabId } from "@/features/inventory/tab-counts";

/**
 * Workiz's Inventory tabs in its order and words (pg_inventory_wz_01_inventory:
 * Inventory, User locations, Locations…). Its Locations are our Warehouses and
 * Containers — two tabs, the owner's call; its Categories and Brands live in
 * the Price Book here; Templates and Transfers are BitCRM's own, last.
 */
const TABS: { id: InventoryTabId; label: string; href: string; resource: Resource }[] = [
  { id: "items", label: "Inventory", href: "/inventory/items", resource: "products" },
  { id: "user-containers", label: "User locations", href: "/inventory/user-containers", resource: "containers" },
  { id: "warehouses", label: "Warehouses", href: "/inventory/warehouses", resource: "warehouses" },
  { id: "containers", label: "Containers", href: "/inventory/containers", resource: "containers" },
  { id: "templates", label: "Templates", href: "/inventory/templates", resource: "containers" },
  { id: "transfers", label: "Transfers", href: "/inventory/transfers", resource: "transfers" },
];

/**
 * The Inventory tab row — Workiz's Tabs-module, 14px under the breadcrumb,
 * each tab with its counter.
 *
 * The row scrolls sideways on its own: on a phone six tabs are wider than the
 * screen, and letting them widen the page laid every popup out wider than the
 * screen too. While the permissions load, and until the page under it is
 * whole (`pending`), each tab holds its place as a placeholder: an empty row
 * that filled in later pushed the page down, and counters drawn one by one
 * slid the tabs sideways.
 */
export function InventoryTabs({
  counts,
  pending = false,
  className,
}: {
  counts?: Partial<Record<InventoryTabId, number>>;
  pending?: boolean;
  className?: string;
}) {
  const pathname = usePathname();
  const { can, isLoading } = usePermissions();
  const waiting = !!isLoading || pending;
  const shown = waiting ? TABS : TABS.filter((t) => can(t.resource));
  // "/inventory/user-containers" must not light "/inventory/containers".
  const active = TABS.find((t) => pathname === t.href || pathname?.startsWith(`${t.href}/`))?.id ?? null;

  return (
    <WzTabLinks
      label="Inventory sections"
      variant="small"
      pending={waiting}
      active={active}
      tabs={shown.map((t) => ({ id: t.id, label: t.label, href: t.href, count: waiting ? undefined : counts?.[t.id] }))}
      className={className}
    />
  );
}
