import { EmptyState } from '../../../src/ui/EmptyState';
import { Screen, ScreenHeader } from '../../../src/ui/Screen';

/** Placeholder until the outbox lands. */
export default function QueueTab() {
  return (
    <Screen testID="queue-screen">
      <ScreenHeader title="Queue" />
      <EmptyState
        title="Nothing waiting"
        body="Actions taken without a signal will be listed here."
      />
    </Screen>
  );
}
