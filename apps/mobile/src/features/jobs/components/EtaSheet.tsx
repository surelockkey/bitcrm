import { View } from 'react-native';
import { useTheme } from '../../../lib/theme/theme-provider';
import { Button } from '../../../ui/Button';
import { MinutesChoices } from './MinutesChoices';
import { Sheet } from './Sheet';

/** Which notice is being sent, or neither of them yet. */
export type EtaStep = 'pick' | 'onMyWay' | 'late';

export interface EtaSheetProps {
  visible: boolean;
  /** Which of the two steps the flow is on. */
  step: EtaStep;
  /** Named so the technician sees who is about to be texted. */
  clientName: string;
  onOnMyWay: () => void;
  onRunningLate: () => void;
  onSelectMinutes: (minutes: number) => void;
  onCancel: () => void;
}

const COPY: Record<
  Exclude<EtaStep, 'pick'>,
  { title: string; body: string; confirmPrefix: string }
> = {
  onMyWay: {
    title: 'On my way',
    body: "The client gets your workspace's own message. Pick how long you expect to be.",
    confirmPrefix: "I'll be there in",
  },
  late: {
    title: 'Running late',
    body: 'The client is told how much longer. Each message is sent on its own — a second, longer delay is never swallowed as a duplicate.',
    confirmPrefix: "I'll be",
  },
};

/**
 * What `ETA` means in Workiz: tell the client you are on the way, **or** that
 * you are running late (`WORKIZ_MOBILE_APP.md` §1.4 — "повідомити клієнта, що
 * ви в дорозі або запізнитесь"). One button in the quick-action row, two
 * notices behind it, then how many minutes.
 *
 * Both steps live in **one** sheet. The choice and the minutes were two modals
 * to begin with, which meant the second was raised in the same commit the first
 * was dismissed — the collision `DayPicker.tsx` already records ("nesting one
 * `Modal` inside another is unreliable on iOS"), and the failure it produces is
 * a technician tapping "Running late" and getting nothing at all. So the sheet
 * stays up and its contents change.
 *
 * Both notices keep their ids, their minute choices and their place on the
 * outbox — all that changed is that they are reached through the word Workiz
 * puts on them.
 */
export function EtaSheet({
  visible,
  step,
  clientName,
  onOnMyWay,
  onRunningLate,
  onSelectMinutes,
  onCancel,
}: EtaSheetProps) {
  const { spacing } = useTheme();
  const who = clientName || 'the client';
  const copy = step === 'pick' ? null : COPY[step];

  return (
    <Sheet
      visible={visible}
      testID="eta-sheet"
      title={copy?.title ?? 'ETA'}
      body={
        copy?.body ??
        `${who} gets a text in your workspace's own words. Pick which one, then how long.`
      }
      // The minutes step answers to the id it has always had, so the cases that
      // cover backing out of it did not have to be rewritten to keep passing.
      closeTestID={copy ? 'minutes-cancel' : undefined}
      onClose={onCancel}
    >
      {copy ? (
        <View testID="minutes-sheet" style={{ gap: spacing.md }}>
          <MinutesChoices
            confirmPrefix={copy.confirmPrefix}
            onSelect={onSelectMinutes}
          />
        </View>
      ) : (
        <>
          <Button
            label="On my way"
            testID="action-on-my-way"
            hint="Leaving for the job now"
            onPress={onOnMyWay}
          />
          <Button
            label="Running late"
            testID="action-late"
            variant="secondary"
            hint="Later than the window they were given"
            onPress={onRunningLate}
          />
        </>
      )}
    </Sheet>
  );
}
