import { router } from 'expo-router';
import { JobsScreen } from '../../../src/features/jobs/jobs-screen';

/**
 * `bitcrm://jobs` — Menu → Jobs, as Workiz has it
 * (`docs/import/WORKIZ_APP_SCREENS_LIVE.md` §2, §7).
 *
 * This is the day list that used to be the first tab, unchanged and still
 * reachable in one tap: on today it is the whole picture — still open from
 * earlier, today, the days ahead, and the jobs dispatch has not dated yet —
 * which is the question "Jobs" asks and the one Schedule's single day does
 * not.
 */
export default function JobsRoute() {
  return (
    <JobsScreen
      onOpenJob={(id) => router.push(`/jobs/${id}`)}
      onBack={() => (router.canGoBack() ? router.back() : router.replace('/'))}
    />
  );
}
