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
  /**
   * Overrides `<testID>-close`. A sheet that walks through steps keeps one
   * modal and changes its contents, so a step whose close button is already
   * known by another id says so here rather than growing a second modal.
   */
  closeTestID?: string;
}

/**
 * The bottom sheet every secondary choice on the job card comes up in.
 *
 * The ETA flow and `RescheduleSheet` each grew their own copy of this shell
 * before the card had tabs and three primary actions; now that Start, ETA and
 * Pay all open one, the shell is here once so they cannot drift apart in
 * padding, corner radius or where "Cancel" sits. `RescheduleSheet` is left on
 * its own copy deliberately — it carries green tests of its own layout and
 * rewriting it buys nothing a technician can see.
 *
 * One sheet is only ever one modal. A flow with two steps swaps `children`
 * inside this one rather than opening a second: raising a modal in the same
 * commit that another is dismissed is the collision `DayPicker.tsx` records,
 * and on iOS the second one simply never appears.
 *
 * "Cancel" is at the bottom with a gap above it, as it is in the reschedule
 * sheet: a mis-tap in a van on the sheet that texts a client is the failure
 * this spacing exists to prevent.
 */
export function Sheet({
  visible,
  title,
  body,
  children,
  onClose,
  closeLabel = 'Cancel',
  testID,
  closeTestID,
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
            testID={closeTestID ?? `${testID}-close`}
          />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: '#0006' },
});
