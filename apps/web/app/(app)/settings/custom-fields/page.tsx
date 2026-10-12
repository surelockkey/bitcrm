import { Suspense } from "react";
import { CustomFieldsPage } from "@/features/custom-fields/components/custom-fields-page";

// The open tab (Job/Lead · Client) lives in `?tab=`; useSearchParams needs a Suspense boundary.
export default function Page() {
  return (
    <Suspense>
      <CustomFieldsPage />
    </Suspense>
  );
}
