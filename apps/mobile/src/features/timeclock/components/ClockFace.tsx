import { StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../../../lib/theme/theme-provider';
import { formatStampTime } from '../../jobs/lib';
import { useDealNumber } from '../hooks';
import {
  clockDealId,
  clockStartedAt,
  formatElapsed,
  formatHoursMinutes,
  type ClockState,
} from '../lib';
import { SECOND_MS, useElapsed } from '../use-elapsed';

/**
 * The running clock itself: what it is doing, and for how long.
 *
 * The number is large and monospaced-by-digit (`tabular-nums`) so it does not
 * jitter as the seconds change — a stopwatch whose width moves every second is
 * hard to read at arm's length in a van.
 *
 * Colour is never the only carrier: "On the clock" is written out, the way the
 * status pills are (`jobs/lib.ts`), so the state survives sunlight and a
 * colour-blind technician.
 */
export function ClockFace({ state }: { state: ClockState }) {
  const { colors, spacing, type } = useTheme();
  const startedAt = clockStartedAt(state);
  const elapsed = useElapsed(startedAt, SECOND_MS);
  const jobNumber = useDealNumber(clockDealId(state));

  const headline =
    state.status === 'on'
      ? 'On the clock'
      : state.status === 'starting'
        ? 'Clocking in'
        : state.status === 'stopping'
          ? 'Clocking out'
          : 'Not on the clock';

  const tone =
    state.status === 'on' || state.status === 'starting'
      ? colors.success
      : colors.textMuted;

  const since = (() => {
    if (state.status === 'stopping') {
      const at = formatStampTime(state.endedAt);
      return at ? `Tapped at ${at} · not on the server yet` : 'Waiting for a signal';
    }
    if (!startedAt) return 'Tap Clock in when you start work.';
    const at = formatStampTime(startedAt) ?? '—';
    const job = jobNumber ? ` · Job ${jobNumber}` : clockDealId(state) ? ' · On a job' : '';
    return state.status === 'starting'
      ? `Tapped at ${at} · not on the server yet${job}`
      : `Since ${at}${job}`;
  })();

  return (
    <View
      testID="clock-face"
      // One element to a screen reader, so it says "On the clock, 1 hour 24
      // minutes, since 9:03 AM" instead of reading a stopwatch digit by digit.
      accessible
      accessibilityLiveRegion="polite"
      accessibilityLabel={
        startedAt && state.status !== 'stopping'
          ? `${headline}, ${formatHoursMinutes(elapsed / 60_000)}. ${since}`
          : `${headline}. ${since}`
      }
      style={{ gap: spacing.xs }}
    >
      <Text style={[type.label, { color: tone }]}>{headline}</Text>
      {startedAt && state.status !== 'stopping' ? (
        <Text
          testID="clock-elapsed"
          accessibilityElementsHidden
          importantForAccessibility="no"
          style={[type.display, styles.stopwatch, { color: colors.text }]}
        >
          {formatElapsed(elapsed)}
        </Text>
      ) : null}
      <Text
        accessibilityElementsHidden
        importantForAccessibility="no"
        style={[type.caption, { color: colors.textMuted }]}
      >
        {since}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  stopwatch: { fontVariant: ['tabular-nums'] },
});
