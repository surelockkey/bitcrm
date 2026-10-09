import { PhoneTabPage } from "@/features/calls/components/phone-shell";
import { BlockedCallersPage } from "@/features/telephony/components/blocked-callers-page";

/** Workiz Phone → "Blocked callers" (`/root/callsReport/blocked-callers`): the list under the section's tabs. */
export default function Page() {
  return (
    <PhoneTabPage>
      <BlockedCallersPage />
    </PhoneTabPage>
  );
}
