import { PhoneTabPage } from "@/features/calls/components/phone-shell";
import { PhoneNumbersPage } from "@/features/telephony/components/phone-numbers-page";

/** Workiz Phone → "Phone numbers" (`/root/callsReport/numbers`): the settings page under the section's tabs. */
export default function Page() {
  return (
    <PhoneTabPage>
      <PhoneNumbersPage />
    </PhoneTabPage>
  );
}
