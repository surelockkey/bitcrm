import { Suspense } from "react";
import { TabFallback } from "@/features/inventory/components/tab-fallback";
import { ContainersPage } from "@/features/inventory/containers/components/containers-page";

// useSearchParams (the `?stock=` / `?edit=` popups) must sit under a Suspense
// boundary.
export default function Page() {
  return (
    // The fallback is the first HTML: the tab's own frame, not a blank body.
    <Suspense fallback={<TabFallback tab="containers" />}>
      <ContainersPage />
    </Suspense>
  );
}
