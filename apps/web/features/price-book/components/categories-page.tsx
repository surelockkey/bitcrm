"use client";

import { usePermissions } from "@/features/auth/use-permissions";
import { useItemCategories } from "@/features/inventory/products/hooks";
import { CatalogTab, type CatalogConfig } from "./catalog-tab";

/** Workiz's words (its `categoryManagement` strings), where they are true of BitCRM. */
const CATEGORIES: CatalogConfig = {
  kind: "categories",
  resource: "product_categories",
  noun: "category",
  addLabel: "Add new",
  subtitle:
    "Item categories help manage and streamline your items, making it easy to navigate your price book and inventory",
  titles: { create: "Create new category", edit: "Edit category" },
  tips: { edit: "Edit category", delete: "Delete category" },
  nameLabel: "Category name",
  enableLabel: "Enable category",
  // Workiz's switch also turns off the items inside; BitCRM's only leaves the pickers.
  enableHint: "Turning this off hides the category from the item pickers; the items filed under it keep it",
  deleteTitle: "Delete category?",
  deleteMessage:
    "It is disabled, not erased: it leaves the item pickers but stays on the items filed under it, and comes back with “Enable category”.",
};

/** The Price book's "Item categories" tab. */
export function CategoriesPage() {
  const { can, isLoading } = usePermissions();
  // Asked for beside the permissions, not after them; the server guards it.
  const query = useItemCategories(isLoading || can("product_categories", "view"));
  return <CatalogTab config={CATEGORIES} query={query} />;
}
