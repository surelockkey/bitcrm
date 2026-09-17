import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../../../lib/theme/theme-provider';
import { Button } from '../../../ui/Button';
import { Card } from '../../../ui/Card';
import { useLocationSharing } from '../../location/location-provider';
import { useClockActions, useClockState } from '../hooks';
import {
  MIN_CLOCK_SEPARATION_MS,
  canClockOut,
  clockStartedAt,
  secondsUntilCanClockOut,
} from '../lib';
import { SECOND_MS, useNow } from '../use-elapsed';
import { ClockFace } from './ClockFace';

export interface ClockCardProps {
  /**
   * Start the clock on this job rather than on the day. Given by the job
   * screen; absent on the timesheet, which is Workiz's "clock in for the day"
   * (`WORKIZ_MOBILE_APP.md` §1.7).
   */
  dealId?: string;
  /** Workiz calls the job-level one "Start"; the day-level one is "Clock in". */
  startLabel?: string;
  /** Somewhere to send a technician whose clock row did not make it. */
  onOpenQueue?: () => void;
  testID?: string;
}

/**
 * Clock in, clock out, and the running clock — one card, wherever it is shown.
 *
 * The button is a `hero`: this is the primary action of the screen it is on,
 * and it is pressed at 7am with a glove on. Only one of the two is ever
 * offered, so there is no possibility of tapping the wrong one, and the label
 * says which way it goes rather than "Toggle".
 */
export function ClockCard({
  dealId,
  startLabel = 'Clock in',
  onOpenQueue,
  testID = 'clock-card',
}: ClockCardProps) {
  const { colors, radius, spacing, type } = useTheme();
  const { state, failed } = useClockState();
  const { clockIn, clockOut } = useClockActions();
  const sharing = useLocationSharing();
  const [busy, setBusy] = useState(false);

  const startedAt = clockStartedAt(state);
  const startedMs = startedAt ? Date.parse(startedAt) : null;
  const running = state.status === 'on' || state.status === 'starting';
  // Ticks only while the one-minute rule can still bite: an eight-hour shift
  // must not re-render this card once a second for a countdown that ended
  // before the technician reached the van.
  const counting =
    startedMs !== null && Date.now() - startedMs < MIN_CLOCK_SEPARATION_MS;
  const now = useNow(counting ? SECOND_MS : null);
  const tooSoon = startedMs !== null && !canClockOut(startedMs, now);
  const waitSeconds = startedMs === null ? 0 : secondsUntilCanClockOut(startedMs, now);

  const run = (action: () => Promise<void>) => {
    setBusy(true);
    void action().finally(() => setBusy(false));
  };

  return (
    <Card testID={testID} style={{ gap: spacing.md }}>
      <ClockFace state={state} />

      {state.status === 'stopping' ? (
        /*
         * Neither button, while the clock-out is still in the queue. "Clock in"
         * here would queue a start behind a stop that has not landed — the lane
         * keeps them in order (`lib/queue/policy.ts`), but the technician would
         * have created a shift boundary they cannot see and did not mean.
         */
        <Button
          label="Clocking out…"
          testID="clock-stopping"
          size="hero"
          busy
          onPress={() => {}}
        />
      ) : running ? (
        <Button
          label="Clock out"
          testID="clock-out"
          size="hero"
          busy={busy}
          disabled={tooSoon}
          hint={
            tooSoon
              ? // Workiz's own rule (§1.7). Said as a wait rather than as a
                // refusal, so the technician knows to try again in a moment
                // instead of assuming the button is broken.
                `A shift has to be at least a minute — ${waitSeconds} s to go`
              : undefined
          }
          onPress={() => run(clockOut)}
        />
      ) : (
        <Button
          label={startLabel}
          testID="clock-in"
          size="hero"
          busy={busy}
          hint={
            sharing.enabled && sharing.permission === 'granted'
              ? 'Your location is shared with the office while your clock runs'
              : undefined
          }
          onPress={() => run(() => clockIn(dealId))}
        />
      )}

      {/* Said while it is happening, not only in Settings. A technician should
          never have to go looking to find out whether they are being followed. */}
      {running && sharing.isSharing ? (
        <Text testID="clock-sharing" style={[type.caption, { color: colors.textMuted }]}>
          Sharing your location with the office while your clock runs. Turn it
          off in Profile.
        </Text>
      ) : null}

      {state.status === 'stopping' ? (
        <Text
          accessibilityLiveRegion="polite"
          style={[type.caption, { color: colors.textMuted }]}
        >
          Waiting for a signal. Your clock stops at the time the office receives
          this.
        </Text>
      ) : null}

      {failed.length ? (
        <View
          testID="clock-failed"
          accessibilityLiveRegion="polite"
          style={[
            styles.banner,
            {
              backgroundColor: colors.dangerSoft,
              borderColor: colors.danger,
              borderRadius: radius.md,
              padding: spacing.md,
              gap: spacing.sm,
            },
          ]}
        >
          <Text style={[type.caption, { color: colors.danger }]}>
            {/* "has not", not "did not": one of these may be a row the app
                died in the middle of sending, which nobody can call either
                way. The Queue screen is where that gets settled. */}
            {failed.length === 1
              ? 'One clock entry has not reached the office. Until it does, those hours are not recorded.'
              : `${failed.length} clock entries have not reached the office. Until they do, those hours are not recorded.`}
          </Text>
          {onOpenQueue ? (
            <Button
              label="See what is waiting"
              testID="clock-open-queue"
              variant="secondary"
              onPress={onOpenQueue}
            />
          ) : null}
        </View>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  banner: { borderWidth: 1 },
});
