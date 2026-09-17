import { Suspense } from "react";
import { DocumentsSettingsPage } from "@/features/documents/components/documents-settings-page";

// The active tab lives in `?tab=`; useSearchParams needs a Suspense boundary.
export default function Page() {
  return (
    <Suspense>
      <DocumentsSettingsPage />
    </Suspense>
  );
}
