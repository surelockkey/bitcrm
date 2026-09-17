import { router } from 'expo-router';
import { ProfileScreen } from '../../src/features/profile/profile-screen';

/** `bitcrm://profile` — Menu → Profile: who this phone is signed in as. */
export default function ProfileRoute() {
  return (
    <ProfileScreen
      onOpenTimesheet={() => router.push('/timesheet')}
      onBack={() => (router.canGoBack() ? router.back() : router.replace('/'))}
    />
  );
}
