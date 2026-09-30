"use client";

import { usePermissions } from "@/features/auth/use-permissions";
import { useBrands } from "@/features/inventory/products/hooks";
import { CatalogTab, type CatalogConfig } from "./catalog-tab";

const BRANDS: CatalogConfig = {
  kind: "brands",
  path: "/price-book/brands",
  resource: "brands",
  noun: "brand",
  Noun: "Brand",
  plural: "brands",
  description: "The maker an item comes from, like Schlage or Kwikset.",
  activeHint: "Only active brands are offered when editing an item.",
  archiveHint:
    "It leaves the item pickers but stays on the items that carry it. You can restore it later.",
};

/** The Price Book's Brands tab. */
export function BrandsPage() {
  const { can } = usePermissions();
  const query = useBrands(can("brands", "view"));
  return <CatalogTab config={BRANDS} query={query} />;
}
