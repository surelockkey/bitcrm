import { router } from 'expo-router';
import { HomeScreen } from '../../../src/features/home/home-screen';

/**
 * The first tab. It was the day list; Workiz's is a dashboard
 * (`docs/import/WORKIZ_APP_SCREENS_LIVE.md` §3), and the list moved one tab
 * across to Schedule, where Workiz keeps it — and stayed reachable on its own
 * as Jobs, off the menu.
 */
export default function HomeTab() {
  return (
    <HomeScreen
      onOpenJob={(id) => router.push(`/jobs/${id}`)}
      onViewAll={() => router.push('/schedule')}
    />
  );
}
