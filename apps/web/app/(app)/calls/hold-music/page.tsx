import { PhoneTabPage } from "@/features/calls/components/phone-shell";
import { HoldMusicPage } from "@/features/telephony/components/hold-music-page";

/** Phone → "Hold music": what a caller hears while the agent has them on hold. */
export default function Page() {
  return (
    <PhoneTabPage>
      <HoldMusicPage />
    </PhoneTabPage>
  );
}
