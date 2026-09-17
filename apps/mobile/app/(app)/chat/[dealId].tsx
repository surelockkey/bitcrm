import { router, useIsFocused, useLocalSearchParams } from 'expo-router';
import { ChatScreen } from '../../../src/features/messaging/chat-screen';

/**
 * `bitcrm://chat/<dealId>` — the same office thread, opened from a job.
 *
 * It is pushed over the tabs rather than switching to the Messages tab, so
 * "Back" returns to the job the technician is standing at. What it adds is the
 * job itself: a line written here reaches the office carrying the job id, the
 * way one in six of Workiz's own in-app messages did
 * (`docs/import/WORKIZ_MOBILE_APP.md` §1.5).
 */
export default function JobChatRoute() {
  const { dealId } = useLocalSearchParams<{ dealId: string }>();

  return (
    <ChatScreen
      live={useIsFocused()}
      dealId={dealId}
      // A line about some *other* job — the screen never offers this for the
      // job the technician came from. Pushed, so Back walks back through the
      // thread to the job they were standing at.
      onOpenJob={(other) => router.push(`/jobs/${other}`)}
      onBack={() =>
        router.canGoBack() ? router.back() : router.replace(dealId ? `/jobs/${dealId}` : '/chat')
      }
    />
  );
}
