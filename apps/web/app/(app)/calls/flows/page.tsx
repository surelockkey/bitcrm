import { PhoneTabPage } from "@/features/calls/components/phone-shell";
import { CallFlowsPage } from "@/features/telephony/components/call-flows-page";

/** Workiz Phone → "Call flows" (`/root/callsReport/flows`): the settings page under the section's tabs. */
export default function Page() {
  return (
    <PhoneTabPage>
      <CallFlowsPage />
    </PhoneTabPage>
  );
}
