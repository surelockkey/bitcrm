import { router } from 'expo-router';
import { TimesheetScreen } from '../../../src/features/timeclock/timesheet-screen';

/**
 * `bitcrm://timesheet` — Workiz's Menu → Timesheets (`WORKIZ_MOBILE_APP.md`
 * §1.12). Pushed over the tabs, so "Back" returns to wherever the technician
 * opened it from.
 */
export default function TimesheetRoute() {
  return (
    <TimesheetScreen
      onBack={() => (router.canGoBack() ? router.back() : router.replace('/'))}
      onOpenQueue={() => router.push('/queue')}
    />
  );
}
