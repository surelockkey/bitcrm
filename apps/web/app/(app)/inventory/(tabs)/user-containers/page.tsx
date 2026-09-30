import { Suspense } from "react";
import { UserContainersPage } from "@/features/inventory/user-containers/components/user-containers-page";

// useSearchParams (the `?assign=` popup) must sit under a Suspense boundary.
export default function Page() {
  return (
    <Suspense>
      <UserContainersPage />
    </Suspense>
  );
}
