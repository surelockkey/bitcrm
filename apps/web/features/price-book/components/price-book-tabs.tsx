"use client";

import { usePathname } from "next/navigation";
import type { Resource } from "@bitcrm/types";
import { WzTabLinks } from "@/components/workiz/page-parts";
import { usePermissions } from "@/features/auth/use-permissions";

/**
 * Workiz's tabs we have, in its order and words (pg_pricebook_wz_01_default):
 * "Items & products", "Item categories", "Item brands". Its "Item groups"
 * and "Catalogs" (Price Book Pro) are not BitCRM's.
 */
const TABS: { id: string; label: string; href: string; resource: Resource }[] = [
  { id: "items", label: "Items & products", href: "/price-book/items", resource: "products" },
  { id: "categories", label: "Item categories", href: "/price-book/categories", resource: "product_categories" },
  { id: "brands", label: "Item brands", href: "/price-book/brands", resource: "brands" },
];

/**
 * The Price book's big tabs (Workiz `_tabs`), each its own route, each behind
 * its own view permission. While the permissions load — and while the frame
 * over them says the page under them is not whole yet (`pending`) — every
 * tab holds its place as a placeholder: an empty row that filled in later
 * was 46px that pushed the whole page down.
 */
export function PriceBookTabs({ className, pending = false }: { className?: string; pending?: boolean }) {
  const pathname = usePathname();
  const { can, isLoading } = usePermissions();
  const waiting = !!isLoading || pending;
  const shown = waiting ? TABS : TABS.filter((t) => can(t.resource));
  const active = TABS.find((t) => pathname?.startsWith(t.href))?.id ?? null;

  return (
    <WzTabLinks
      label="Price Book sections"
      variant="page"
      pending={waiting}
      active={active}
      tabs={shown}
      className={className}
    />
  );
}
