import { Alert, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../../../lib/theme/theme-provider';
import { openExternalUrl } from '../../../lib/linking';
import { Button } from '../../../ui/Button';
import { Card } from '../../../ui/Card';
import { useMaskedCall } from '../../telephony/use-masked-call';
import { addressLine, clientDisplayName, formatSlot, navigationUrl } from '../lib';
import type { Deal } from '../types';
import { JobStamps } from './JobStamps';
import { StatusPill } from './StatusPill';

export interface JobCardProps {
  deal: Deal;
  onOpen: (dealId: string) => void;
}

/**
 * One stop on the route.
 *
 * Leads with the time, because that is what a technician scans the list for,
 * then the client, the address, and the two things they do without opening the
 * job: drive there and call ahead. Those two are full-width buttons rather than
 * tappable text — the card itself is a target too, and a mis-tap that opens a
 * job is free while a mis-tap that calls a client is not (§2.9).
 */
export function JobCard({ deal, onOpen }: JobCardProps) {
  const { colors, spacing, type } = useTheme();
  const call = useMaskedCall();

  const time = formatSlot(deal.scheduledTimeSlot, deal.allDay);
  const client = clientDisplayName(deal);
  const address = addressLine(deal.address);
  const mapUrl = navigationUrl(deal.address);

  return (
    <Card
      testID={`job-card-${deal.id}`}
      onPress={() => onOpen(deal.id)}
      accessibilityLabel={`Job ${deal.dealNumber}${client ? `, ${client}` : ''}, ${time}`}
      accessibilityHint="Opens the job"
      style={{ gap: spacing.md }}
    >
      <View style={styles.topRow}>
        <Text style={[type.title, styles.flexShrink, { color: colors.text }]}>
          {time}
        </Text>
        <StatusPill status={deal.superStatus} />
      </View>

      <View>
        {client ? (
          <Text style={[type.heading, { color: colors.text }]}>{client}</Text>
        ) : null}
        <Text style={[type.caption, { color: colors.textMuted }]}>
          Job {deal.dealNumber}
        </Text>
      </View>

      {address ? (
        <Text style={[type.body, { color: colors.textMuted }]}>{address}</Text>
      ) : null}

      <JobStamps deal={deal} />

      <View style={{ gap: spacing.md }}>
        <Button
          label="Navigate"
          variant="secondary"
          disabled={!mapUrl}
          accessibilityHint={
            mapUrl ? 'Opens the address in your maps app' : 'This job has no address'
          }
          onPress={() => {
            void openExternalUrl(mapUrl).then((opened) => {
              if (!opened) {
                Alert.alert(
                  'Could not open maps',
                  'No maps app answered. The address is on the job screen to copy.',
                );
              }
            });
          }}
        />
        <Button
          label="Call client"
          variant="secondary"
          busy={call.isPending}
          accessibilityHint="Rings your phone, then connects you to the client"
          onPress={() =>
            call.mutate({ dealId: deal.id, contactId: deal.contactId })
          }
        />
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  flexShrink: { flexShrink: 1 },
});
