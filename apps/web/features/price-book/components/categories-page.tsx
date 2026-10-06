"use client";

import { usePermissions } from "@/features/auth/use-permissions";
import { useItemCategories } from "@/features/inventory/products/hooks";
import { CatalogTab, type CatalogConfig } from "./catalog-tab";

const CATEGORIES: CatalogConfig = {
  kind: "categories",
  path: "/price-book/categories",
  resource: "product_categories",
  noun: "category",
  Noun: "Category",
  plural: "categories",
  description: "A group items are filed under, like Locks or Keys.",
  activeHint: "Only active categories are offered when filing an item.",
  archiveHint:
    "It leaves the item pickers but stays on the items filed under it. You can restore it later.",
  // Items carry the category's name, not its id, and the API doesn't rename them.
  renameHint: (old) =>
    `Items filed under “${old}” keep that name — renaming the category doesn't move them.`,
};

/** The Price Book's Categories tab. */
export function CategoriesPage() {
  const { can, isLoading } = usePermissions();
  // Asked for beside the permissions, not after them; the server guards it.
  const query = useItemCategories(isLoading || can("product_categories", "view"));
  return <CatalogTab config={CATEGORIES} query={query} />;
}
