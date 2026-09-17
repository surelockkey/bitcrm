import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../../../lib/theme/theme-provider';
import { Button } from '../../../ui/Button';
import { useLocationSharing } from '../location-provider';
import { openPhoneSettings } from '../permission';

/**
 * "Location Tracking" — the switch Workiz puts in Settings
 * (`WORKIZ_MOBILE_APP.md` §1.12), in the place this app keeps settings.
 *
 * Workiz's help centre describes the same three levels we have: the account
 * allows it, the user's profile allows it, and the device allows it. This row
 * owns the second and reports honestly on the third — a switch that says "On"
 * while the phone is quietly refusing is the one thing it must never do.
 *
 * Built from a `Pressable` rather than the platform `Switch` on purpose: the
 * whole row is the target, so it clears the 56 dp glove floor the rest of the
 * app holds to, and the state is a **word** as well as a colour, which a small
 * green switch at arm's length in sunlight is not.
 */
export function LocationSettingRow() {
  const { colors, radius, spacing, touch, type } = useTheme();
  const { enabled, setEnabled, permission, askForConsent, isSharing } =
    useLocationSharing();

  const blocked = enabled && permission === 'denied';
  const stateWord = !enabled ? 'Off' : blocked ? 'Blocked' : isSharing ? 'Sharing now' : 'On';

  const toggle = () => {
    const next = !enabled;
    void setEnabled(next);
    // Turning it on is the moment to explain, and the only moment the phone can
    // still be asked. Turning it off asks nothing and stops the watcher inside
    // the same render (`location-provider.tsx`).
    if (next && permission === 'undetermined') askForConsent();
  };

  return (
    <View style={{ gap: spacing.sm }}>
      <Pressable
        testID="location-toggle"
        accessibilityRole="switch"
        accessibilityLabel="Location Tracking"
        accessibilityState={{ checked: enabled }}
        accessibilityHint="Shares where you are with the office while your clock is running"
        onPress={toggle}
        style={({ pressed }) => [
          styles.row,
          {
            minHeight: touch.min,
            gap: spacing.lg,
            padding: spacing.lg,
            borderRadius: radius.lg,
            backgroundColor: colors.surface,
            borderColor: colors.border,
            opacity: pressed ? 0.85 : 1,
          },
        ]}
      >
        <View style={styles.text}>
          <Text style={[type.body, { color: colors.text }]}>Location Tracking</Text>
          <Text style={[type.caption, { color: colors.textMuted }]}>
            Only while you are on the clock, and only while the app is open.
          </Text>
        </View>
        <Text
          testID="location-toggle-state"
          accessibilityElementsHidden
          importantForAccessibility="no"
          style={[
            type.label,
            {
              color: blocked
                ? colors.danger
                : enabled
                  ? colors.success
                  : colors.textMuted,
            },
          ]}
        >
          {stateWord}
        </Text>
      </Pressable>

      {blocked ? (
        <View style={{ gap: spacing.sm }}>
          <Text
            testID="location-blocked"
            accessibilityLiveRegion="polite"
            style={[type.caption, { color: colors.danger }]}
          >
            Your phone is not letting BitCRM see your location. Nothing is being
            sent. You can still clock in and out.
          </Text>
          <Button
            label="Open phone settings"
            testID="location-open-settings"
            variant="secondary"
            onPress={() => void openPhoneSettings()}
          />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: StyleSheet.hairlineWidth,
  },
  text: { flexShrink: 1 },
});
