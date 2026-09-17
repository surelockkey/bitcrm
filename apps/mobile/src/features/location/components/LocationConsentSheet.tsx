import { Modal, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../../../lib/theme/theme-provider';
import { Button } from '../../../ui/Button';

export interface LocationConsentSheetProps {
  visible: boolean;
  /** Read the explainer, then show the phone's own prompt. */
  onAllow: () => void;
  /** Leave the switch on, but do not ask the phone yet. */
  onNotNow: () => void;
  /** Turn sharing off for good. */
  onTurnOff: () => void;
}

/**
 * Why the office wants to know where you are — said before the phone asks.
 *
 * The system dialog cannot say who is asking or what for; it can only be shown
 * once; and a technician who refuses it there can only undo that in the phone's
 * own Settings. So the explanation comes first, in one sentence, in the words
 * the person holding the phone would use.
 *
 * The three lines under it are the promises the rest of this feature keeps, and
 * each is enforced in code rather than merely written here: on the clock only
 * and app-open only are the gates in `location-provider.tsx`, and the switch is
 * `settings.ts`. "Turn it off" is offered as an equal choice rather than buried,
 * because an explainer whose only way out is "Allow" is not an explanation.
 */
export function LocationConsentSheet({
  visible,
  onAllow,
  onNotNow,
  onTurnOff,
}: LocationConsentSheetProps) {
  const { colors, radius, spacing, type } = useTheme();

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onNotNow}>
      <View style={styles.backdrop}>
        <View
          testID="location-consent"
          style={{
            backgroundColor: colors.background,
            borderTopLeftRadius: radius.lg,
            borderTopRightRadius: radius.lg,
            padding: spacing.lg,
            gap: spacing.md,
            maxHeight: '85%',
          }}
        >
          <Text accessibilityRole="header" style={[type.title, { color: colors.text }]}>
            Share your location while you are on the clock
          </Text>

          <ScrollView contentContainerStyle={{ gap: spacing.md }}>
            <Text style={[type.body, { color: colors.text }]}>
              While your clock is running, the office can see where you are, so
              dispatch sends you the job you are nearest to and can back you up
              on where you were if a customer ever asks.
            </Text>

            <View style={{ gap: spacing.sm }}>
              <Assurance text="Only while you are clocked in. Clock out and it stops." />
              <Assurance text="Only while this app is open on your screen." />
              <Assurance text="You can switch it off in Profile whenever you like." />
            </View>

            <Button
              label="Allow location"
              testID="location-allow"
              size="hero"
              onPress={onAllow}
            />
            <Button
              label="Not now"
              testID="location-not-now"
              variant="secondary"
              hint="You can still clock in and out"
              onPress={onNotNow}
            />
            <Button
              label="Turn location sharing off"
              testID="location-turn-off"
              variant="ghost"
              onPress={onTurnOff}
            />
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function Assurance({ text }: { text: string }) {
  const { colors, spacing, type } = useTheme();
  return (
    <View style={[styles.assurance, { gap: spacing.sm }]}>
      {/* A shape, not an icon font: the app ships no glyphs of its own. */}
      <View
        style={[styles.bullet, { backgroundColor: colors.success }]}
        accessibilityElementsHidden
        importantForAccessibility="no"
      />
      <Text style={[type.label, styles.assuranceText, { color: colors.textMuted }]}>
        {text}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: '#0006' },
  assurance: { flexDirection: 'row', alignItems: 'flex-start' },
  bullet: { width: 8, height: 8, borderRadius: 4, marginTop: 7 },
  assuranceText: { flexShrink: 1 },
});
