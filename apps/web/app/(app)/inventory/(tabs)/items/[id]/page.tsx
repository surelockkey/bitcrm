import { Suspense } from "react";
import { TabFallback } from "@/features/inventory/components/tab-fallback";
import { ProductsPage } from "@/features/inventory/products/components/products-page";

/**
 * A link to an item — a bookmark, an old note, the search index's
 * `/inventory/products/<id>` — lands on the Items tab with the item's Edit
 * popup open: the list itself, its popup opened from its state, nothing in
 * the query. Closing it leaves `/inventory/items`. `params` is a Promise in
 * Next 16.
 */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <Suspense fallback={<TabFallback tab="items" />}>
      <ProductsPage initialPopup={{ kind: "edit", id }} />
    </Suspense>
  );
}
