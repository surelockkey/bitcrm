import { Suspense } from "react";
import { InboxPage } from "@/features/messaging/components/inbox-page";

// useSearchParams (the `?c=` / `?view=` deep links) must sit under a Suspense boundary.
export default function Page() {
  return (
    <Suspense>
      <InboxPage />
    </Suspense>
  );
}
