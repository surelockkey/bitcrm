import { Suspense } from "react";
import { ItemsPage } from "@/features/price-book/components/items-page";

// useSearchParams (the `?edit=` / `?new=` popups) must sit under a Suspense boundary.
export default function Page() {
  return (
    <Suspense>
      <ItemsPage />
    </Suspense>
  );
}
