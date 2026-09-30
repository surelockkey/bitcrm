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

/** Workiz-style section tabs under the Price Book header — the Inventory tabs' look. */
export function PriceBookTabs({ className }: { className?: string }) {
  const pathname = usePathname();
  const { can } = usePermissions();

  return (
    <nav aria-label="Price Book sections" className={cn("flex gap-5", className)}>
      {TABS.filter((t) => can(t.resource)).map((t) => {
        const active = pathname.startsWith(t.href);
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "border-b-2 pb-2 text-sm font-medium transition-colors",
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
