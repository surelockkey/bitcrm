import { Suspense } from "react";
import { AutomationActivityPage } from "@/features/automations/components/automation-activity-page";

// useSearchParams (the `?rule=` link from a rule's own log) must sit under a
// Suspense boundary.
export default function Page() {
  return (
    <Suspense>
      <AutomationActivityPage />
    </Suspense>
  );
}
