import { Suspense } from "react";
import { TabFallback } from "@/features/inventory/components/tab-fallback";
import { UserContainersPage } from "@/features/inventory/user-containers/components/user-containers-page";

// useSearchParams (the `?assign=` popup) must sit under a Suspense boundary.
export default function Page() {
  return (
    // The fallback is the first HTML: the tab's own frame, not a blank body.
    <Suspense fallback={<TabFallback tab="user-containers" />}>
      <UserContainersPage />
    </Suspense>
  );
}
