"use client";

import { usePermissions } from "@/features/auth/use-permissions";
import { useBrands } from "@/features/inventory/products/hooks";
import { CatalogTab, type CatalogConfig } from "./catalog-tab";

/** Workiz's words (its `Brand` strings), where they are true of BitCRM. */
const BRANDS: CatalogConfig = {
  kind: "brands",
  resource: "brands",
  noun: "brand",
  addLabel: "Add New",
  titles: { create: "Create new brand", edit: "Edit brand" },
  tips: { edit: "Edit", delete: "Delete" },
  nameLabel: "Brand name",
  // Workiz deletes a brand; BitCRM disables it, so its popup carries the switch.
  enableLabel: "Enable brand",
  enableHint: "Turning this off hides the brand from the item pickers; the items that carry it keep it",
  deleteTitle: "Are you sure you want to delete?",
  deleteMessage:
    "The brand is disabled, not erased: it leaves the item pickers but stays on the items that carry it, and comes back with “Enable brand”.",
};

/** The Price book's "Item brands" tab. */
export function BrandsPage() {
  const { can, isLoading } = usePermissions();
  // Asked for beside the permissions, not after them; the server guards it.
  const query = useBrands(isLoading || can("brands", "view"));
  return <CatalogTab config={BRANDS} query={query} />;
}
