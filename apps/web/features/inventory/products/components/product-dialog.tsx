"use client";

import { usePathname } from "next/navigation";
import type { Product } from "@bitcrm/types";
import {
  ItemEditDialog,
  type ItemVariant,
} from "@/features/inventory/item-edit/item-edit-dialog";

/** Price Book pages open Workiz's "Edit Item"; everything else "Edit Inventory item". */
export function variantForPath(pathname: string | null | undefined): ItemVariant {
  return pathname?.startsWith("/price-book") ? "price-book" : "inventory";
}

/**
 * The item's Edit / New popup, as Workiz draws it — Inventory's "Edit
 * Inventory item" or Price Book's "Edit Item" (see ItemEditDialog).
 *
 * Controlled by its props alone: `open` / `onOpenChange` and `productId`
 * (null for a new item), so a page may drive it from its URL or its state.
 * `variant` picks the Workiz popup; left out, it follows the page the popup
 * opens on (a Price Book path gets "Edit Item").
 */
export function ProductDialog({
  productId,
  open,
  onOpenChange,
  onCreated,
  variant,
}: {
  productId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (product: Product) => void;
  variant?: ItemVariant;
}) {
  const pathname = usePathname();
  return (
    <ItemEditDialog
      productId={productId}
      open={open}
      onOpenChange={onOpenChange}
      onCreated={onCreated}
      variant={variant ?? variantForPath(pathname)}
    />
  );
}
