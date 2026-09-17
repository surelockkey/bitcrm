import { router } from 'expo-router';
import { ProfileScreen } from '../../src/features/profile/profile-screen';

/**
 * `bitcrm://settings` — Menu → Settings, where Workiz keeps it
 * (`docs/import/WORKIZ_APP_SCREENS_LIVE.md` §2, §10): the controls a
 * technician actually owns, and nothing else.
 */
export default function SettingsRoute() {
  return (
    <ProfileScreen
      variant="settings"
      onOpenTimesheet={() => router.push('/timesheet')}
      onBack={() => (router.canGoBack() ? router.back() : router.replace('/'))}
    />
  );
}
