import { PhoneTabPage } from "@/features/calls/components/phone-shell";
import { CallGroupsPage } from "@/features/telephony/components/call-groups-page";

/** Workiz Phone → "Call groups" (`/root/callsReport/groups`): the settings page under the section's tabs. */
export default function Page() {
  return (
    <PhoneTabPage>
      <CallGroupsPage />
    </PhoneTabPage>
  );
}
