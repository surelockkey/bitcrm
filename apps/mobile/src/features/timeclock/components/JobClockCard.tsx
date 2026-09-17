import { Text, View } from 'react-native';
import { useTheme } from '../../../lib/theme/theme-provider';
import { useClockState, useDealNumber } from '../hooks';
import { clockDealId, isOnTheClock } from '../lib';
import { ClockCard } from './ClockCard';

/**
 * The clock, on a job.
 *
 * Workiz's quick-action panel leads with **Start**, which "launches a running
 * clock" against that job (`WORKIZ_MOBILE_APP.md` §1.4) — so the word is kept
 * and it sits first. It is inside a section called "Time clock" on our screen
 * rather than loose among the other actions, because this screen already spends
 * "Start work" on the status move that Workiz makes from its Details tab, and
 * two buttons beginning with "Start" next to each other is the one thing a
 * technician of twenty years' standing should not have to puzzle over.
 *
 * Only 15.3% of the 15 277 timeclock rows in the export carry a `job_id`
 * (§1.7): clocking in for the day is the common case and lives on the timesheet.
 * This is the other one.
 */
export function JobClockCard({ dealId }: { dealId: string }) {
  const { colors, spacing, type } = useTheme();
  const { state } = useClockState();
  const otherDealId = clockDealId(state);
  const elsewhere = isOnTheClock(state) && otherDealId !== dealId;
  const otherNumber = useDealNumber(otherDealId);

  return (
    <View style={{ gap: spacing.sm }}>
      {elsewhere ? (
        <Text
          testID="clock-elsewhere"
          accessibilityLiveRegion="polite"
          style={[type.caption, { color: colors.warning }]}
        >
          {otherDealId
            ? `Your clock is already running on job ${otherNumber ?? otherDealId}. Clock out there before you start here.`
            : 'Your clock is already running for the day. Clock out before you start it on this job.'}
        </Text>
      ) : null}
      <ClockCard dealId={dealId} startLabel="Start" testID="job-clock-card" />
    </View>
  );
}
