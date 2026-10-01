import { Suspense } from "react";
import { TabFallback } from "@/features/inventory/components/tab-fallback";
import { UserContainersPage } from "@/features/inventory/user-containers/components/user-containers-page";

// A popup is the list's state, never the address.
export default function Page() {
  return (
    // The tab's own frame, not a blank body, while anything under it suspends.
    <Suspense fallback={<TabFallback tab="user-containers" />}>
      <UserContainersPage />
    </Suspense>
  );
}
