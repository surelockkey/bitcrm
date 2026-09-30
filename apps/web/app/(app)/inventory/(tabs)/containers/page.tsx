import { Suspense } from "react";
import { TabFallback } from "@/features/inventory/components/tab-fallback";
import { ContainersPage } from "@/features/inventory/containers/components/containers-page";

// A popup is the list's state, never the address.
export default function Page() {
  return (
    // The tab's own frame, not a blank body, while anything under it suspends.
    <Suspense fallback={<TabFallback tab="containers" />}>
      <ContainersPage />
    </Suspense>
  );
}
