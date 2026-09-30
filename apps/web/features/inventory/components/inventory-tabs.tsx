"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Resource } from "@bitcrm/types";
import { cn } from "@/lib/utils";
import { usePermissions } from "@/features/auth/use-permissions";

const TABS: { label: string; href: string; resource: Resource }[] = [
  { label: "Items", href: "/inventory/items", resource: "products" },
  { label: "Warehouses", href: "/inventory/warehouses", resource: "warehouses" },
  { label: "Containers", href: "/inventory/containers", resource: "containers" },
  { label: "User containers", href: "/inventory/user-containers", resource: "containers" },
  { label: "Templates", href: "/inventory/templates", resource: "containers" },
  { label: "Transfers", href: "/inventory/transfers", resource: "transfers" },
];

/** One tab's shape — the link and its placeholder share it, so they are the same size. */
const TAB = "flex-none border-b-2 pb-2 text-sm font-medium whitespace-nowrap";

/**
 * Workiz-style section tabs under the Inventory header.
 *
 * The row scrolls sideways on its own: on a phone six tabs are wider than the
 * screen, and letting them widen the page laid every popup out wider than the
 * screen too. While the permissions load, each tab holds its place as a
 * placeholder — an empty row that filled in later pushed the page down.
 */
export function InventoryTabs({ className }: { className?: string }) {
  const pathname = usePathname();
  const { can, isLoading } = usePermissions();

  return (
    <nav
      aria-label="Inventory sections"
      aria-busy={isLoading || undefined}
      className={cn(
        "flex max-w-full gap-5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
        className,
      )}
    >
      {isLoading
        ? TABS.map((t) => (
            <span key={t.href} data-tab-placeholder aria-hidden className={cn(TAB, "border-transparent")}>
              <span className="animate-pulse rounded bg-muted text-transparent">{t.label}</span>
            </span>
          ))
        : TABS.filter((t) => can(t.resource)).map((t) => {
            const active = pathname.startsWith(t.href);
            return (
              <Link
                key={t.href}
                href={t.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  TAB,
                  "transition-colors",
                  active
                    ? "border-foreground text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground",
                )}
              >
                {t.label}
              </Link>
            );
          })}
    </nav>
  );
}
