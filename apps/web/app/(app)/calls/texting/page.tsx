import { PhoneTabPage } from "@/features/calls/components/phone-shell";
import { MessagingSettingsPage } from "@/features/messaging/components/messaging-settings-page";

/**
 * Workiz Phone → "Texting" (`/root/callsReport/texting`): Workiz's messaging
 * compliance and forwarding settings; ours are Settings → Messaging.
 */
export default function Page() {
  return (
    <PhoneTabPage>
      <MessagingSettingsPage />
    </PhoneTabPage>
  );
}
