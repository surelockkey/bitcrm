import { Modal, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../../../lib/theme/theme-provider';
import { Button } from '../../../ui/Button';

/** The delays anyone actually says out loud. The server accepts 1…600. */
export const MINUTE_CHOICES = [10, 15, 20, 30, 45, 60, 90] as const;

export interface MinutesSheetProps {
  visible: boolean;
  title: string;
  body: string;
  confirmPrefix: string;
  onSelect: (minutes: number) => void;
  onCancel: () => void;
}

/**
 * How many minutes.
 *
 * A list of large buttons rather than a wheel or a keypad: this is tapped in a
 * van, one-handed, often with a glove on, and every option clears the 56 dp
 * floor with room between them (docs/ARCHITECTURE.md §2.9). "Cancel" is at the
 * bottom, well away from the choices, because a mis-tap here texts a client.
 */
export function MinutesSheet({
  visible,
  title,
  body,
  confirmPrefix,
  onSelect,
  onCancel,
}: MinutesSheetProps) {
  const { colors, radius, spacing, type } = useTheme();

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onCancel}
    >
      <View style={styles.backdrop}>
        <View
          testID="minutes-sheet"
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
            {title}
          </Text>
          <Text style={[type.body, { color: colors.textMuted }]}>{body}</Text>

          <ScrollView contentContainerStyle={{ gap: spacing.md }}>
            {MINUTE_CHOICES.map((minutes) => (
              <Button
                key={minutes}
                label={`${confirmPrefix} ${minutes} minutes`}
                testID={`minutes-${minutes}`}
                onPress={() => onSelect(minutes)}
              />
            ))}
          </ScrollView>

          <View style={{ height: spacing.lg }} />
          <Button label="Cancel" variant="ghost" onPress={onCancel} testID="minutes-cancel" />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: '#0006' },
});
