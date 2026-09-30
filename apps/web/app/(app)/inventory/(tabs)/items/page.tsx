import { Suspense } from "react";
import { TabFallback } from "@/features/inventory/components/tab-fallback";
import { ProductsPage } from "@/features/inventory/products/components/products-page";

// useSearchParams (the `?edit=` / `?stock=` / `?new=` popups) must sit under a
// Suspense boundary.
export default function Page() {
  return (
    // The fallback is the first HTML: the tab's own frame, not a blank body.
    <Suspense fallback={<TabFallback tab="items" />}>
      <ProductsPage />
    </Suspense>
  );
}
