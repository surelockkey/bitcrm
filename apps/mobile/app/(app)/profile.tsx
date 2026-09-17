import { router } from 'expo-router';
import { ProfileScreen } from '../../../src/features/profile/profile-screen';

export default function ProfileTab() {
  return <ProfileScreen onOpenTimesheet={() => router.push('/timesheet')} />;
}
