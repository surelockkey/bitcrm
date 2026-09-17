import { router, useLocalSearchParams } from 'expo-router';
import { PhotosScreen } from '../../../../src/features/photos/photos-screen';
import { EmptyState } from '../../../../src/ui/EmptyState';
import { Screen } from '../../../../src/ui/Screen';

/** `bitcrm://jobs/<dealId>/photos`. */
export default function JobPhotosRoute() {
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
    <PhotosScreen
      dealId={id}
      onBack={() => (router.canGoBack() ? router.back() : router.replace(`/jobs/${id}`))}
    />
  );
}
