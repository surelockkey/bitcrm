import { router } from 'expo-router';
import { QueueScreen } from '../../src/features/queue/queue-screen';

/**
 * `bitcrm://queue` — Menu → Waiting to send.
 *
 * A tab until the bar was cut to Workiz's three. The count it used to carry on
 * that tab is now a dot on the burger and a number on the menu row, so a
 * technician still learns about unsent work without opening anything.
 */
export default function QueueRoute() {
  return (
    <QueueScreen
      onOpenJob={(dealId) => router.push(`/jobs/${dealId}`)}
      onBack={() => (router.canGoBack() ? router.back() : router.replace('/'))}
    />
  );
}
