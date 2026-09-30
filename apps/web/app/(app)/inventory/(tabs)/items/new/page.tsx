import { Suspense } from "react";
import { TabFallback } from "@/features/inventory/components/tab-fallback";
import { ProductsPage } from "@/features/inventory/products/components/products-page";

/** An old "New item" link: the Items tab with the New item popup open. */
export default function Page() {
  return (
    <Suspense fallback={<TabFallback tab="items" />}>
      <ProductsPage initialPopup={{ kind: "new" }} />
    </Suspense>
  );
}
