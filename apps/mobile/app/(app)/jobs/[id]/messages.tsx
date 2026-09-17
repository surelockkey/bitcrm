import { router, useIsFocused, useLocalSearchParams } from 'expo-router';
import { ClientThreadScreen } from '../../../../src/features/messaging/client-thread-screen';
import { EmptyState } from '../../../../src/ui/EmptyState';
import { Screen } from '../../../../src/ui/Screen';

/**
 * `bitcrm://jobs/<dealId>/messages` — the text thread with the job's **client**.
 *
 * A route of the job, not of the Messages tab, and that is deliberate: the tab
 * is the one thread with the office, and the client's thread only ever exists
 * in the context of a job the technician is on — which is also the only context
 * the server will hand it over in, under `assigned_only`.
 *
 * Pushed over the job, so Back returns to the job the technician is standing at.
 */
export default function ClientMessagesRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const focused = useIsFocused();

  if (!id) {
    return (
      <Screen>
        <EmptyState
          title="No job in that link"
          actionLabel="Back to my jobs"
          onAction={() => router.replace('/')}
        />
      </Screen>
    );
  }

  return (
    <ClientThreadScreen
      dealId={id}
      live={focused}
      // A line about another of this client's jobs leads to that job.
      onOpenJob={(other) => router.push(`/jobs/${other}`)}
      onBack={() =>
        router.canGoBack() ? router.back() : router.replace(`/jobs/${id}`)
      }
    />
  );
}
