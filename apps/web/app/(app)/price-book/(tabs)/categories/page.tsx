import { Suspense } from "react";
import { CategoriesPage } from "@/features/price-book/components/categories-page";

// useSearchParams (the `?edit=` / `?new=` popups) must sit under a Suspense boundary.
export default function Page() {
  return (
    <Suspense>
      <CategoriesPage />
    </Suspense>
  );
}
