import { Button } from '../../../ui/Button';
import { Sheet } from './Sheet';

export interface EtaSheetProps {
  visible: boolean;
  /** Named so the technician sees who is about to be texted. */
  clientName: string;
  onOnMyWay: () => void;
  onRunningLate: () => void;
  onCancel: () => void;
}

/**
 * What `ETA` means in Workiz: tell the client you are on the way, **or** that
 * you are running late (`WORKIZ_MOBILE_APP.md` §1.4 — "повідомити клієнта, що
 * ви в дорозі або запізнитесь"). One button in the quick-action row, two
 * notices behind it.
 *
 * Both were loose buttons on this screen before the card had the row. They keep
 * their ids, their sheets and their place on the outbox — all that changed is
 * that they are reached through the word Workiz puts on them.
 */
export function EtaSheet({
  visible,
  clientName,
  onOnMyWay,
  onRunningLate,
  onCancel,
}: EtaSheetProps) {
  const who = clientName || 'the client';
  return (
    <Sheet
      visible={visible}
      testID="eta-sheet"
      title="ETA"
      body={`${who} gets a text in your workspace's own words. Pick which one, then how long.`}
      onClose={onCancel}
    >
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
    </Sheet>
  );
}
