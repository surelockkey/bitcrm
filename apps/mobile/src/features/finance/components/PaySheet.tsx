import { StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../../../lib/theme/theme-provider';
import { Sheet } from '../../jobs/components/Sheet';
import { PAY_NOT_CONNECTED, payMethods } from '../mock';

/**
 * What `Pay` does this wave: says what it will do, and says plainly that it
 * does none of it yet.
 *
 * The button is in the quick-action row because that is where Workiz puts it
 * and where a technician reaches for it (§1.4) — leaving the slot empty would
 * move the other two and teach the wrong muscle memory for the wave after
 * this one. But no amount is shown, no method is selectable, and nothing is
 * sent: 34 171 payments were taken from the app in this account's history, and
 * a screen that looks like it took one and did not is the worst outcome
 * available here.
 *
 * The methods are listed as text, not as buttons, for that reason: there is
 * nothing to press, so there is nothing that can look pressable.
 */
export function PaySheet({
  visible,
  onClose,
}: {
  visible: boolean;
  onClose: () => void;
}) {
  const { colors, radius, spacing, type } = useTheme();

  return (
    <Sheet
      visible={visible}
      testID="pay-sheet"
      title="Pay"
      closeLabel="Close"
      onClose={onClose}
    >
      <View
        testID="pay-not-connected"
        accessibilityLiveRegion="polite"
        style={[
          styles.banner,
          {
            backgroundColor: colors.warningSoft,
            borderColor: colors.warning,
            borderRadius: radius.md,
            padding: spacing.md,
          },
        ]}
      >
        <Text style={[type.body, { color: colors.warning }]}>
          {PAY_NOT_CONNECTED}
        </Text>
      </View>

      <Text style={[type.heading, { color: colors.textMuted }]}>
        What this will do
      </Text>
      {payMethods().map((method) => (
        <View
          key={method.key}
          testID={`pay-method-${method.key}`}
          style={[
            styles.row,
            {
              backgroundColor: colors.surface,
              borderColor: colors.border,
              borderRadius: radius.md,
              padding: spacing.md,
            },
          ]}
        >
          <Text style={[type.body, { color: colors.text }]}>{method.label}</Text>
          <Text style={[type.caption, { color: colors.textMuted }]}>
            {method.note}
          </Text>
        </View>
      ))}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  banner: { borderWidth: 1 },
  row: { borderWidth: StyleSheet.hairlineWidth, gap: 2 },
});
