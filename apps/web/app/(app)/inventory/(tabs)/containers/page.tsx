import { Suspense } from "react";
import { ContainersPage } from "@/features/inventory/containers/components/containers-page";

// useSearchParams (the `?stock=` / `?edit=` popups) must sit under a Suspense
// boundary.
export default function Page() {
  return (
    <Suspense>
      <ContainersPage />
    </Suspense>
  );
}
