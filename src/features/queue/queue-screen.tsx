import { Alert, ScrollView, Text, View } from 'react-native';
import { useTheme } from '../../lib/theme/theme-provider';
import { Button } from '../../ui/Button';
import { Card } from '../../ui/Card';
import { EmptyState } from '../../ui/EmptyState';
import { Screen, ScreenHeader } from '../../ui/Screen';
import { describeQueue, summarizeQueue, type QueueItemView } from './lib';
import { useQueue } from './queue-provider';

export interface QueueScreenProps {
  /** Opens the job a queued item belongs to. */
  onOpenJob: (dealId: string) => void;
}

/**
 * "Nothing has been lost."
 *
 * This screen exists because a queue with no window onto it is
 * indistinguishable, from the technician's side, from work quietly
 * disappearing (docs/ARCHITECTURE.md §2.5). Everything waiting is named, the
 * reason anything failed is the server's own words, and every parked row has a
 * button to try it again — one at a time, or all of them at once after coming
 * back into signal.
 */
export function QueueScreen({ onOpenJob }: QueueScreenProps) {
  const { colors, spacing, type } = useTheme();
  const { records, retry, retryAll, discard, drainNow, isDraining } = useQueue();

  const items = describeQueue(records, Date.now());
  const counts = summarizeQueue(records);
  const outstanding = counts.waiting + counts.sending + counts.failed;

  if (!outstanding) {
    return (
      <Screen testID="queue-screen">
        <ScreenHeader title="Queue" />
        <EmptyState
          testID="queue-empty"
          title="Everything has been sent"
          body="Anything you do without a signal waits here until the phone can reach the server. Right now there is nothing waiting."
        />
      </Screen>
    );
  }

  return (
    <Screen testID="queue-screen">
      <ScreenHeader
        title="Queue"
        subtitle={
          counts.failed
            ? `${counts.failed} not sent · ${counts.waiting + counts.sending} on the way`
            : `${counts.waiting + counts.sending} on the way`
        }
      />
      <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }}>
        <View style={{ gap: spacing.md }}>
          <Button
            label="Send everything now"
            testID="queue-drain"
            busy={isDraining}
            onPress={() => void drainNow()}
          />
          {counts.failed > 0 ? (
            <Button
              label={`Try the ${counts.failed} that failed again`}
              testID="queue-retry-all"
              variant="secondary"
              onPress={() => void retryAll()}
            />
          ) : null}
        </View>

        {items.map((item) => (
          <QueueRow
            key={`${item.queue}:${item.id}`}
            item={item}
            onOpenJob={onOpenJob}
            onRetry={() => void retry(item.queue, item.id)}
            onDiscard={() =>
              Alert.alert(
                'Discard this?',
                'It has not reached the server, and this deletes it from the phone.',
                [
                  { text: 'Keep it', style: 'cancel' },
                  {
                    text: 'Discard',
                    style: 'destructive',
                    onPress: () => void discard(item.queue, item.id),
                  },
                ],
              )
            }
          />
        ))}

        <Text style={[type.caption, { color: colors.textMuted }]}>
          The queue empties itself whenever the app is open and the phone has a
          signal. Nothing here is lost by closing the app.
        </Text>
        <View style={{ height: spacing.xl }} />
      </ScrollView>
    </Screen>
  );
}

function QueueRow({
  item,
  onOpenJob,
  onRetry,
  onDiscard,
}: {
  item: QueueItemView;
  onOpenJob: (dealId: string) => void;
  onRetry: () => void;
  onDiscard: () => void;
}) {
  const { colors, spacing, type } = useTheme();
  const failed = item.state === 'failed';

  return (
    <Card testID={`queue-item-${item.id}`} style={{ gap: spacing.sm }}>
      <Text style={[type.label, { color: colors.text }]}>{item.title}</Text>
      <Text
        accessibilityLiveRegion="polite"
        style={[type.caption, { color: failed ? colors.danger : colors.textMuted }]}
      >
        {item.detail}
      </Text>

      <View style={{ gap: spacing.md, marginTop: spacing.sm }}>
        <Button
          label="Open the job"
          variant="ghost"
          testID={`queue-open-${item.id}`}
          onPress={() => onOpenJob(item.dealId)}
        />
        {item.canRetry ? (
          <Button
            label="Try again now"
            variant={failed ? 'primary' : 'secondary'}
            testID={`queue-retry-${item.id}`}
            onPress={onRetry}
          />
        ) : null}
        {item.canDiscard ? (
          <Button
            label="Discard"
            variant="ghost"
            testID={`queue-discard-${item.id}`}
            onPress={onDiscard}
          />
        ) : null}
      </View>
    </Card>
  );
}
