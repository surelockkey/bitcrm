import { Suspense } from "react";
import {
  InventoryUsageReportFallback,
  InventoryUsageReportPage,
} from "@/features/reports/inventory-usage/components/inventory-usage-report-page";

// The tab, the dates and the filters live in the URL: `useSearchParams` must
// sit under a Suspense boundary. The fallback is the page's own header, so the
// first HTML is the report's frame rather than a blank body.
export default function Page() {
  return (
    <Suspense fallback={<InventoryUsageReportFallback />}>
      <InventoryUsageReportPage />
    </Suspense>
  );
}
