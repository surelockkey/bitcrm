import { Suspense } from "react";
import { TemplatesPage } from "@/features/inventory/templates/components/templates-page";

// useSearchParams (the `?template=` / `?apply=` popups) must sit under a Suspense boundary.
export default function Page() {
  return (
    <Suspense>
      <TemplatesPage />
    </Suspense>
  );
}
