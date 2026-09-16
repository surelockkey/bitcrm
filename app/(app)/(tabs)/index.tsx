import { EmptyState } from '../../../src/ui/EmptyState';
import { Screen, ScreenHeader } from '../../../src/ui/Screen';

/** Placeholder until the day list lands on top of the data layer. */
export default function JobsTab() {
  return (
    <Screen testID="jobs-screen">
      <ScreenHeader title="My jobs" />
      <EmptyState
        title="Not wired up yet"
        body="The day list arrives with the data layer."
      />
    </Screen>
  );
}
