import { Button } from '../../../ui/Button';

/** The delays anyone actually says out loud. The server accepts 1…600. */
export const MINUTE_CHOICES = [10, 15, 20, 30, 45, 60, 90] as const;

export interface MinutesChoicesProps {
  confirmPrefix: string;
  onSelect: (minutes: number) => void;
}

/**
 * How many minutes.
 *
 * A list of large buttons rather than a wheel or a keypad: this is tapped in a
 * van, one-handed, often with a glove on, and every option clears the 56 dp
 * floor with room between them (docs/ARCHITECTURE.md §2.9).
 *
 * Contents only, with no sheet of its own. It is the second step of the ETA
 * flow and is drawn inside the sheet the first step already opened — the same
 * reason `MonthGrid` is kept apart from `RescheduleSheet` (`DayPicker.tsx`):
 * raising one modal while another is coming down is unreliable on iOS, and the
 * moment a technician is telling a client they are late is not where that gets
 * discovered.
 */
export function MinutesChoices({ confirmPrefix, onSelect }: MinutesChoicesProps) {
  return (
    <>
      {MINUTE_CHOICES.map((minutes) => (
        <Button
          key={minutes}
          label={`${confirmPrefix} ${minutes} minutes`}
          testID={`minutes-${minutes}`}
          onPress={() => onSelect(minutes)}
        />
      ))}
    </>
  );
}
