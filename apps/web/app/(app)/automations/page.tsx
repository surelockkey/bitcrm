import { Suspense } from "react";
import { AutomationsPage } from "@/features/automations/components/automations-page";

/**
 * The Automation Center — a first-level module, not a settings sub-page.
 * useSearchParams (`?view=discover|mine`, the tab links from Activity) must
 * sit under a Suspense boundary.
 */
export default function Page() {
  return (
    <Suspense>
      <AutomationsPage />
    </Suspense>
  );
}
