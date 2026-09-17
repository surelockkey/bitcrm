import { useEffect, useState } from 'react';
import { Alert, ScrollView, Text, View } from 'react-native';
import { useTheme } from '../../lib/theme/theme-provider';
import { Button } from '../../ui/Button';
import { Card } from '../../ui/Card';
import { EmptyState } from '../../ui/EmptyState';
import { Screen, ScreenHeader } from '../../ui/Screen';
import {
  describeQueue,
  queueTickInterval,
  summarizeQueue,
  type QueueItemView,
} from './lib';
import { useQueue } from './queue-provider';

export interface QueueScreenProps {
  /** Opens the job a queued item belongs to. */
  onOpenJob: (dealId: string) => void;
  /** Drawn as Back: this is opened from the menu now rather than being a tab. */
  onBack?: () => void;
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
export function QueueScreen({ onOpenJob, onBack }: QueueScreenProps) {
  const { colors, spacing, type } = useTheme();
  const { records, retry, retryAll, discard, drainNow, isDraining } = useQueue();

  // A countdown that does not count down is worse than no countdown: it says
  // "trying again in 14 min" for as long as the screen stays open. `records`
  // only changes when a drain settles something, so the clock has to be its
  // own piece of state.
  const [now, setNow] = useState(() => Date.now());
  const interval = queueTickInterval(records, now);
  useEffect(() => {
    if (interval === null) return;
    const timer = setInterval(() => setNow(Date.now()), interval);
    return () => clearInterval(timer);
  }, [interval]);

  const items = describeQueue(records, now);
  const counts = summarizeQueue(records);
  const outstanding =
    counts.waiting + counts.sending + counts.failed + counts.unknown;

  if (!outstanding) {
    return (
      <Screen testID="queue-screen">
        <ScreenHeader title="Queue" onBack={onBack} />
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
        onBack={onBack}
        subtitle={[
          counts.unknown ? `${counts.unknown} need checking` : null,
          counts.failed ? `${counts.failed} not sent` : null,
          `${counts.waiting + counts.sending} on the way`,
        ]
          .filter(Boolean)
          .join(' · ')}
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
                item.state === 'unknown'
                  ? 'Use this once you have opened the job and seen that it did reach the server. It only deletes it from the phone.'
                  : 'It has not reached the server, and this deletes it from the phone.',
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
  const unknown = item.state === 'unknown';

  return (
    <Card testID={`queue-item-${item.id}`} style={{ gap: spacing.sm }}>
      <Text style={[type.label, { color: colors.text }]}>{item.title}</Text>
      <Text
        accessibilityLiveRegion="polite"
        style={[
          type.caption,
          { color: failed ? colors.danger : unknown ? colors.warning : colors.textMuted },
        ]}
      >
        {item.detail}
      </Text>

      <View style={{ gap: spacing.md, marginTop: spacing.sm }}>
        {/* A row about no job — a line to the office — has no job to open.
            It cannot be `unknown` either: it is replayed on its own id, so it
            never needs a human to decide whether it landed. */}
        {item.dealId ? (
          <Button
            label={unknown ? 'Open the job and check' : 'Open the job'}
            variant={unknown ? 'primary' : 'ghost'}
            testID={`queue-open-${item.id}`}
            onPress={() => onOpenJob(item.dealId)}
          />
        ) : null}
        {item.canRetry ? (
          <Button
            label={unknown ? 'Send it again' : 'Try again now'}
            hint={unknown ? 'Only if the job does not show it' : undefined}
            variant={failed ? 'primary' : 'secondary'}
            testID={`queue-retry-${item.id}`}
            onPress={onRetry}
          />
        ) : null}
        {item.canDiscard ? (
          <Button
            label={unknown ? 'It is already on the job' : 'Discard'}
            variant="ghost"
            testID={`queue-discard-${item.id}`}
            onPress={onDiscard}
          />
        ) : null}
      </View>
    </Card>
  );
}
