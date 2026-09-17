import { Alert, StyleSheet, Text, View } from 'react-native';
import { openExternalUrl } from '../../../lib/linking';
import { useTheme } from '../../../lib/theme/theme-provider';
import { Card } from '../../../ui/Card';
import { addressLine, navigationUrl } from '../lib';
import type { Address } from '../types';

/**
 * The first thing on a Workiz job card: the map, with the service address on
 * it, and tapping it hands the address to the phone's own navigation.
 *
 * **We draw no map tiles, deliberately.** Tiles mean either a native map view
 * — a second SDK, a second API key, and a native build this wave does not take
 * — or a static-map image fetched over the technician's own connection, which
 * is a grey rectangle exactly when it matters most: no signal, on a road, at
 * the top of the screen a technician needs. What the map is actually *for*
 * here is the tap that opens directions, and that works with no tiles, no key
 * and no bytes. So the block keeps the position, the size and the single job
 * Workiz's map has, and says what it is instead of pretending to be a picture
 * of somewhere.
 */
export function JobMapCard({ address }: { address: Address | undefined }) {
  const { colors, radius, spacing, type } = useTheme();
  const line = addressLine(address);
  const url = navigationUrl(address);
  const located = typeof address?.lat === 'number' && typeof address?.lng === 'number';

  if (!line) {
    return (
      <Card testID="job-map">
        <Text style={[type.body, { color: colors.textMuted }]}>
          This job has no address on it. Ask the office for one.
        </Text>
      </Card>
    );
  }

  return (
    <Card
      testID="job-map"
      onPress={() => {
        void openExternalUrl(url).then((opened) => {
          if (!opened) {
            Alert.alert(
              'Could not open maps',
              'No maps app answered. The address is on the card, ready to copy.',
            );
          }
        });
      }}
      accessibilityLabel={`Navigate to ${line}`}
      accessibilityHint="Opens your maps app with directions to the job"
    >
      <View style={[styles.row, { gap: spacing.md }]}>
        <View
          // A pin, drawn rather than fetched: a shape at a glance, and it is
          // painted from the theme so it holds up in both schemes.
          style={[
            styles.pin,
            {
              backgroundColor: colors.primarySoft,
              borderColor: colors.primary,
              borderRadius: radius.md,
            },
          ]}
        >
          <View style={[styles.pinDot, { backgroundColor: colors.primary }]} />
        </View>
        <View style={styles.grow}>
          <Text style={[type.heading, { color: colors.text }]}>{line}</Text>
          <Text style={[type.caption, { color: colors.textMuted }]}>
            {located
              ? 'Tap to navigate — the pin the office geocoded, not the typed street'
              : 'Tap to navigate'}
          </Text>
        </View>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  grow: { flexShrink: 1, gap: 2 },
  pin: {
    width: 56,
    height: 56,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pinDot: { width: 14, height: 14, borderRadius: 7 },
});
