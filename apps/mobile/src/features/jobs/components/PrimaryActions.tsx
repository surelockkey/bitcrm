import { StyleSheet, View } from 'react-native';
import { useTheme } from '../../../lib/theme/theme-provider';
import { Button } from '../../../ui/Button';
import { useClockActions, useClockState } from '../../timeclock/hooks';
import {
  clockDealId,
  clockStartedAt,
  formatElapsedShort,
  isOnTheClock,
} from '../../timeclock/lib';
import { HALF_MINUTE_MS, useElapsed } from '../../timeclock/use-elapsed';

export interface PrimaryActionsProps {
  dealId: string;
  /** Opens the sheet that owns Clock out and everything around it. */
  onOpenClock: () => void;
  onOpenEta: () => void;
  onOpenPay: () => void;
  /** False on a closed job: there is no arrival left to give an ETA for. */
  canNotify: boolean;
}

/**
 * `Start` · `ETA` · `Pay` — Workiz's quick-action panel, in its order.
 *
 * These three sit in one row directly under the tabs because that is where two
 * decades of muscle memory reaches for them (`WORKIZ_MOBILE_APP.md` §1.4, and
 * the owner's rule: UX theirs, UI ours). Their words are kept verbatim; only
 * the drawing is ours. Workiz's two remaining quick actions, Add note and
 * Attach, stay down in the Details tab with the things they write to — a row of
 * five on a phone held in one hand puts every target under 56 dp.
 */
export function PrimaryActions({
  dealId,
  onOpenClock,
  onOpenEta,
  onOpenPay,
  canNotify,
}: PrimaryActionsProps) {
  const { spacing } = useTheme();
  const { state, isLoading } = useClockState();
  const { clockIn } = useClockActions();

  const running = isOnTheClock(state);
  const onThisJob = running && clockDealId(state) === dealId;
  const startedAt = clockStartedAt(state);
  // Minute resolution: a seconds counter three buttons wide would flicker, and
  // nobody reads the seconds off a row they are about to tap.
  const elapsed = useElapsed(onThisJob ? startedAt : null, HALF_MINUTE_MS);

  return (
    <View style={[styles.row, { gap: spacing.md }]}>
      {/*
        One tap starts the clock, as it does in Workiz. Every case that is not
        "start it now" — stopping it, a clock left running on another job, a row
        the queue gave up on — opens the sheet, so the one-minute rule and the
        unrecorded-hours banner stay in `ClockCard`, which already owns them and
        is tested against them.
      */}
      <Button
        label={onThisJob ? 'Running' : 'Start'}
        testID="action-clock"
        size="hero"
        style={styles.cell}
        busy={isLoading}
        hint={
          onThisJob
            ? formatElapsedShort(elapsed)
            : running
              ? 'On another job'
              : undefined
        }
        accessibilityHint={
          onThisJob
            ? 'Your clock is running on this job. Opens the time clock.'
            : 'Starts your clock on this job'
        }
        onPress={() => {
          if (running || state.status === 'stopping') {
            onOpenClock();
            return;
          }
          void clockIn(dealId);
        }}
      />
      {/*
        Workiz's ETA is one button for both notices — "you are on the way or
        you are late" — so it opens a sheet with those two rather than spending
        two of the three slots on them.
      */}
      <Button
        label="ETA"
        testID="action-eta"
        size="hero"
        variant="secondary"
        style={styles.cell}
        // The slot is kept on a closed job rather than removed, so Pay does not
        // slide under the thumb that was reaching for ETA.
        disabled={!canNotify}
        accessibilityHint="Tells the client you are on the way, or running late"
        onPress={onOpenEta}
      />
      <Button
        label="Pay"
        testID="action-pay"
        size="hero"
        variant="secondary"
        style={styles.cell}
        accessibilityHint="Taking payment is not connected yet"
        onPress={onOpenPay}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'stretch' },
  cell: { flex: 1 },
});
