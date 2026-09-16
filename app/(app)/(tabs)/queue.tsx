import { router } from 'expo-router';
import { QueueScreen } from '../../../src/features/queue/queue-screen';

export default function QueueTab() {
  return <QueueScreen onOpenJob={(dealId) => router.push(`/jobs/${dealId}`)} />;
}
