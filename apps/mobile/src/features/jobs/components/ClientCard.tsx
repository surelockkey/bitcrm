import { Text, View } from 'react-native';
import { useTheme } from '../../../lib/theme/theme-provider';
import { Button } from '../../../ui/Button';
import { Card } from '../../../ui/Card';
import { clientPhone } from '../lib';
import type { Contact } from '../types';

export interface ClientCardProps {
  /** The job's own name for the client; empty when nobody is on the job. */
  name: string;
  /** One-line service address. */
  address: string;
  /** The contact record, once it has landed. Absent offline on a cold cache. */
  contact: Contact | undefined;
  onCall: () => void;
  callBusy: boolean;
  onText: () => void;
  canText: boolean;
}

/**
 * The Client block, in Workiz's order: name, address, phone, then the two
 * controls that reach them (§1.4).
 *
 * The number is shown but never dialled from here. Calling goes through the
 * masked bridge so the client sees the company's number and the technician's
 * own stays private (`telephony/use-masked-call.ts`) — the digits on screen
 * are for reading aloud and writing down, which is what a technician at a door
 * actually does with them.
 */
export function ClientCard({
  name,
  address,
  contact,
  onCall,
  callBusy,
  onText,
  canText,
}: ClientCardProps) {
  const { colors, spacing, type } = useTheme();
  const phone = clientPhone(contact);

  return (
    <Card testID="job-client">
      <Text style={[type.title, { color: colors.text }]}>
        {name || 'No client on this job'}
      </Text>
      {address ? (
        <Text style={[type.body, { color: colors.textMuted }]}>{address}</Text>
      ) : null}

      {/* Three different absences, said three different ways. "No phone number
          on file" is a fact about the client, so it is printed only once the
          record is actually here — offline on a cold start it is not, and a
          technician who reads it there stops looking for a number that exists
          (`lib.ts`, `ClientPhone.known`). */}
      <Text testID="client-phone" style={[type.body, { color: colors.text }]}>
        {phone.display ??
          (!phone.known
            ? 'Number not on this phone yet'
            : phone.hidden
              ? phone.hidden === 1
                ? '1 number, hidden'
                : `${phone.hidden} numbers, hidden`
              : 'No phone number on file')}
      </Text>
      {phone.extra ? (
        <Text style={[type.caption, { color: colors.textMuted }]}>
          {phone.extra === 1
            ? 'One more number on file'
            : `${phone.extra} more numbers on file`}
        </Text>
      ) : null}

      <View style={{ gap: spacing.md, marginTop: spacing.sm }}>
        {/* Label kept as "Call client" rather than a bare "Call": a job screen
            also reaches the office, and the two must not be told apart only by
            which row they happen to sit in. */}
        <Button
          label="Call client"
          testID="action-call-client"
          variant="secondary"
          busy={callBusy}
          accessibilityHint="Rings your phone, then connects you to the client"
          onPress={onCall}
        />
        <Button
          label={name ? `Text ${name}` : 'Text the client'}
          testID="action-text-client"
          variant="secondary"
          hint="Their own text thread — they see it, the office does not"
          disabled={!canText}
          onPress={onText}
        />
      </View>
    </Card>
  );
}
