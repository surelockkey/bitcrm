import { JobClockCard } from '../../timeclock/components/JobClockCard';
import { Sheet } from './Sheet';

/**
 * The time clock for this job, behind the `Start` action.
 *
 * `Start` itself clocks in with one tap, as Workiz's does. This sheet is where
 * the other cases live — clocking out, a clock left running on another job, a
 * clock row the queue gave up on — because all three belong to `ClockCard`,
 * which already owns the one-minute rule and the unrecorded-hours banner and is
 * tested against them. Reaching them through a sheet costs one tap and keeps
 * that logic in one place instead of two.
 */
export function TimeClockSheet({
  visible,
  dealId,
  onClose,
}: {
  visible: boolean;
  dealId: string;
  onClose: () => void;
}) {
  return (
    <Sheet
      visible={visible}
      testID="clock-sheet"
      title="Time clock"
      body="Your clock on this job. The office sees the hours as soon as the phone has a signal."
      closeLabel="Close"
      onClose={onClose}
    >
      <JobClockCard dealId={dealId} />
    </Sheet>
  );
}
