import { Suspense } from "react";
import { ProductsPage } from "@/features/inventory/products/components/products-page";

// useSearchParams (the `?edit=` / `?stock=` / `?new=` popups) must sit under a
// Suspense boundary.
export default function Page() {
  return (
    <Suspense>
      <ProductsPage />
    </Suspense>
  );
}
