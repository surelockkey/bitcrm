import { StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../../../lib/theme/theme-provider';
import { Button } from '../../../ui/Button';
import type { FeedRow } from '../lib';

export interface MessageBubbleProps {
  row: FeedRow;
  /** Offered on a line the queue gave up on; absent, no button is drawn. */
  onRetry?: (queueId: string) => void;
}

/**
 * One line of the thread.
 *
 * The technician's own words on the right, the office's on the left, each with
 * the name above and the time below — the web Inbox's bubble, in this app's
 * colours and at this app's sizes. A line that has not reached the office yet
 * says so under itself in the queue's own words, and one that failed carries
 * the reason and a retry: a message typed at a job and silently lost is the
 * same failure as a photo silently lost (docs/ARCHITECTURE.md §2.5).
 */
export function MessageBubble({ row, onRetry }: MessageBubbleProps) {
  const { colors, radius, spacing, type } = useTheme();
  const ink = row.mine ? colors.onAccent : colors.text;

  return (
    <View
      testID={`message-${row.key}`}
      style={[styles.line, { alignItems: row.mine ? 'flex-end' : 'flex-start' }]}
    >
      <View
        style={[
          styles.bubble,
          {
            backgroundColor: row.mine ? colors.primary : colors.surface,
            borderColor: row.failed ? colors.danger : colors.border,
            borderRadius: radius.lg,
            padding: spacing.lg,
            gap: spacing.xs,
          },
        ]}
      >
        <Text style={[type.caption, { color: ink, opacity: 0.85 }]}>{row.name}</Text>
        <Text style={[type.body, { color: ink }]}>{row.body}</Text>
      </View>

      <View style={[styles.meta, { gap: spacing.sm, marginTop: spacing.xs }]}>
        {row.time ? (
          <Text style={[type.caption, { color: colors.textMuted }]}>{row.time}</Text>
        ) : null}
        {row.status ? (
          <Text
            accessibilityLiveRegion="polite"
            style={[
              type.caption,
              styles.status,
              { color: row.failed ? colors.danger : colors.textMuted },
            ]}
          >
            {row.status}
          </Text>
        ) : null}
      </View>

      {row.failed && row.queueId && onRetry ? (
        <Button
          label="Try again"
          testID={`message-retry-${row.queueId}`}
          variant="secondary"
          style={styles.retry}
          onPress={() => onRetry(row.queueId as string)}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  line: { width: '100%' },
  // Never the full width: the side a bubble is on is what says who wrote it.
  bubble: { maxWidth: '86%', borderWidth: StyleSheet.hairlineWidth },
  meta: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' },
  status: { flexShrink: 1 },
  retry: { marginTop: 8, alignSelf: 'flex-end' },
});
