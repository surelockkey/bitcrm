import { PhoneTabPage } from "@/features/calls/components/phone-shell";
import { CallDevicesPage } from "@/features/telephony/components/call-devices-page";

/** Workiz Phone → "Devices" (`/root/callsReport/devices`): the desk phones and shop lines, under the section's tabs. */
export default function Page() {
  return (
    <PhoneTabPage>
      <CallDevicesPage />
    </PhoneTabPage>
  );
}
