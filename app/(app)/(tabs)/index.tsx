import { router } from 'expo-router';
import { JobsScreen } from '../../../src/features/jobs/jobs-screen';

export default function JobsTab() {
  return <JobsScreen onOpenJob={(id) => router.push(`/jobs/${id}`)} />;
}
