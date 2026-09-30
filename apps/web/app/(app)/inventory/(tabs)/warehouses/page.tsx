import { Suspense } from "react";
import { TabFallback } from "@/features/inventory/components/tab-fallback";
import { WarehousesPage } from "@/features/inventory/warehouses/components/warehouses-page";

// A popup is the list's state; a link to a warehouse is its own page (warehouses/[id]).
export default function Page() {
  return (
    // The tab's own frame, not a blank body, while anything under it suspends.
    <Suspense fallback={<TabFallback tab="warehouses" />}>
      <WarehousesPage />
    </Suspense>
  );
}
