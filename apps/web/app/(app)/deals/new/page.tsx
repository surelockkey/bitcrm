import { Suspense } from "react";
import { NewDealPage } from "@/features/deals/components/new-deal-page";

// useSearchParams (the `?callSid=` the dialer sends) must sit under a Suspense
// boundary.
export default function Page() {
  return (
    <Suspense>
      <NewDealPage />
    </Suspense>
  );
}
