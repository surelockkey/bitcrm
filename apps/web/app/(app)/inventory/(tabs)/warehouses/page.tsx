import { Suspense } from "react";
import { WarehousesPage } from "@/features/inventory/warehouses/components/warehouses-page";

// useSearchParams (the `?stock=` / `?edit=` popups) must sit under a Suspense
// boundary.
export default function Page() {
  return (
    <Suspense>
      <WarehousesPage />
    </Suspense>
  );
}
