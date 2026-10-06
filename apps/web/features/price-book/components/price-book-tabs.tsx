"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Resource } from "@bitcrm/types";
import { cn } from "@/lib/utils";
import { usePermissions } from "@/features/auth/use-permissions";

const TABS: { label: string; href: string; resource: Resource }[] = [
  { label: "Items", href: "/price-book/items", resource: "products" },
  { label: "Categories", href: "/price-book/categories", resource: "product_categories" },
  { label: "Brands", href: "/price-book/brands", resource: "brands" },
];

/** One tab's shape — the link and its placeholder share it, so they are the same size. */
const TAB = "border-b-2 pb-2 text-sm font-medium";

/**
 * Workiz-style section tabs under the Price Book header — the Inventory tabs' look.
 *
 * While the permissions load, each tab holds its place as a placeholder: an
 * empty row that filled in later was 30px that pushed the whole page down.
 */
export function PriceBookTabs({ className }: { className?: string }) {
  const pathname = usePathname();
  const { can, isLoading } = usePermissions();

  return (
    <nav aria-label="Price Book sections" aria-busy={isLoading || undefined} className={cn("flex gap-5", className)}>
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
