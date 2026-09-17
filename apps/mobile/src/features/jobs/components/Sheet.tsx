import React from 'react';
import { Modal, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../../../lib/theme/theme-provider';
import { Button } from '../../../ui/Button';

export interface SheetProps {
  visible: boolean;
  title: string;
  /** One line under the title saying what this sheet is for. */
  body?: string;
  children: React.ReactNode;
  onClose: () => void;
  /** "Cancel" where a tap commits something; "Close" where nothing does. */
  closeLabel?: string;
  testID: string;
}

/**
 * The bottom sheet every secondary choice on the job card comes up in.
 *
 * `MinutesSheet` and `RescheduleSheet` each grew their own copy of this shell
 * before the card had tabs and three primary actions; now that Start, ETA and
 * Pay all open one, the shell is here once so the four cannot drift apart in
 * padding, corner radius or where "Cancel" sits. The two older sheets are left
 * on their own copies deliberately — they carry green tests of their own layout
 * and rewriting them buys nothing a technician can see.
 *
 * "Cancel" is at the bottom with a gap above it, as it is in those two: a
 * mis-tap in a van on the sheet that texts a client is the failure this spacing
 * exists to prevent.
 */
export function Sheet({
  visible,
  title,
  body,
  children,
  onClose,
  closeLabel = 'Cancel',
  testID,
}: SheetProps) {
  const { colors, radius, spacing, type } = useTheme();

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <View style={styles.backdrop}>
        <View
          testID={testID}
          style={{
            backgroundColor: colors.background,
            borderTopLeftRadius: radius.lg,
            borderTopRightRadius: radius.lg,
            padding: spacing.lg,
            gap: spacing.md,
            maxHeight: '88%',
          }}
        >
          <Text accessibilityRole="header" style={[type.title, { color: colors.text }]}>
            {title}
          </Text>
          {body ? (
            <Text style={[type.body, { color: colors.textMuted }]}>{body}</Text>
          ) : null}

          <ScrollView contentContainerStyle={{ gap: spacing.md }}>
            {children}
          </ScrollView>

          <View style={{ height: spacing.lg }} />
          <Button
            label={closeLabel}
            variant="ghost"
            onPress={onClose}
            testID={`${testID}-close`}
          />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: '#0006' },
});
