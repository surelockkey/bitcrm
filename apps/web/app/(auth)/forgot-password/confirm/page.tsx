import { Suspense } from "react";
import { ResetConfirmView } from "@/features/auth/components/reset-confirm-view";

// useSearchParams (inside the view) must sit under a Suspense boundary.
export default function ResetConfirmPage() {
  return (
    <Suspense>
      <ResetConfirmView />
    </Suspense>
  );
}
