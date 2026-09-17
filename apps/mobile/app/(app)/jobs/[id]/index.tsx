import { router, useLocalSearchParams } from 'expo-router';
import { JobDetailScreen } from '../../../../src/features/jobs/job-detail-screen';
import { EmptyState } from '../../../../src/ui/EmptyState';
import { Screen } from '../../../../src/ui/Screen';

/** `bitcrm://jobs/<dealId>` — where a push notification lands. */
export default function JobRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();

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
    <JobDetailScreen
      dealId={id}
      onBack={() => (router.canGoBack() ? router.back() : router.replace('/'))}
      onOpenPhotos={(dealId) => router.push(`/jobs/${dealId}/photos`)}
    />
  );
}
