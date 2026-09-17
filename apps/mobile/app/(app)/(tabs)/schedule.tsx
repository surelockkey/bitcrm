import { router } from 'expo-router';
import { ScheduleScreen } from '../../../src/features/schedule/schedule-screen';

/**
 * `bitcrm://schedule` — Workiz's second tab
 * (`docs/import/WORKIZ_APP_SCREENS_LIVE.md` §4): the day as a list
 * (**Timeline**) or as an hour grid (**Day**).
 */
export default function ScheduleTab() {
  return <ScheduleScreen onOpenJob={(id) => router.push(`/jobs/${id}`)} />;
}
