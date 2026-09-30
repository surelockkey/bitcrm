import { Suspense } from "react";
import { BrandsPage } from "@/features/price-book/components/brands-page";

// useSearchParams (the `?edit=` / `?new=` popups) must sit under a Suspense boundary.
export default function Page() {
  return (
    <Suspense>
      <BrandsPage />
    </Suspense>
  );
}
