import { Suspense } from "react";
import { TabFallback } from "@/features/inventory/components/tab-fallback";
import { TemplatesPage } from "@/features/inventory/templates/components/templates-page";

// useSearchParams (the `?template=` / `?apply=` popups) must sit under a Suspense boundary.
export default function Page() {
  return (
    // The fallback is the first HTML: the tab's own frame, not a blank body.
    <Suspense fallback={<TabFallback tab="templates" />}>
      <TemplatesPage />
    </Suspense>
  );
}
