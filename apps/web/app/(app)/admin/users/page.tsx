import { Suspense } from "react";
import { UsersPage } from "@/features/users/components/users-page";

// useSearchParams (the `?user=` deep link) must sit under a Suspense boundary.
export default function Page() {
  return (
    <Suspense>
      <UsersPage />
    </Suspense>
  );
}
