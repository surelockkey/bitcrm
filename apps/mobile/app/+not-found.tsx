import { router } from 'expo-router';
import { EmptyState } from '../src/ui/EmptyState';
import { Screen } from '../src/ui/Screen';

/**
 * Where a stale deep link lands — a push notification for a job that has since
 * been deleted, say. It offers the way back rather than a dead end.
 */
export default function NotFound() {
  return (
    <Screen testID="not-found-screen" edges={['top', 'bottom', 'left', 'right']}>
      <EmptyState
        title="That page is gone"
        body="The link you followed does not lead anywhere in the app."
        actionLabel="Back to my jobs"
        onAction={() => router.replace('/')}
      />
    </Screen>
  );
}
