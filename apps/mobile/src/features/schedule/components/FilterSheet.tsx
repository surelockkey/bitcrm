import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../../../lib/theme/theme-provider';
import { Button } from '../../../ui/Button';
import type { Deal } from '../../jobs/types';
import { statusOptions, type ScheduleFilter } from '../lib';

export interface FilterSheetProps {
  visible: boolean;
  deals: readonly Deal[];
  filter: ScheduleFilter;
  onChange: (filter: ScheduleFilter) => void;
  onClose: () => void;
}

/**
 * Workiz's filter sheet is `Status`, `Tags`, `Type`
 * (`docs/import/WORKIZ_APP_SCREENS_LIVE.md` §4). Ours is **Status**, and only
 * Status, because that is the only one of the three there is anything behind:
 * a BitCRM deal carries no tags at all, and its `jobTypeId` is an id with no
 * name on the phone to show for it. A section offering two headings that
 * filter nothing would be the same lie as a menu row that opens nothing.
 *
 * The statuses offered are the ones actually on the technician's jobs, with
 * their counts, so the sheet can never offer a row that empties the list.
 */
export function FilterSheet({
  visible,
  deals,
  filter,
  onChange,
  onClose,
}: FilterSheetProps) {
  const { colors, radius, spacing, touch, type } = useTheme();
  const options = statusOptions(deals);
  const chosen = new Set(filter.statuses.map(String));

  const toggle = (status: string) => {
    const next = new Set(chosen);
    if (next.has(status)) next.delete(status);
    else next.add(status);
    onChange({ statuses: [...next] });
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View
          testID="filter-sheet"
          style={{
            backgroundColor: colors.background,
            borderTopLeftRadius: radius.lg,
            borderTopRightRadius: radius.lg,
            padding: spacing.lg,
            gap: spacing.md,
          }}
        >
          <Text accessibilityRole="header" style={[type.title, { color: colors.text }]}>
            Filter
          </Text>
          <Text style={[type.caption, { color: colors.textMuted }]}>Status</Text>

          <ScrollView style={styles.list} contentContainerStyle={{ gap: spacing.sm }}>
            {options.length === 0 ? (
              <Text style={[type.body, { color: colors.textMuted }]}>
                Nothing to filter yet.
              </Text>
            ) : (
              options.map((option) => {
                const selected = chosen.has(String(option.status));
                return (
                  <Pressable
                    key={String(option.status)}
                    testID={`filter-status-${option.status}`}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: selected }}
                    accessibilityLabel={`${option.label}, ${option.count}`}
                    onPress={() => toggle(String(option.status))}
                    style={({ pressed }) => [
                      styles.row,
                      {
                        minHeight: touch.min,
                        borderRadius: radius.md,
                        paddingHorizontal: spacing.md,
                        borderWidth: selected ? 2 : StyleSheet.hairlineWidth,
                        borderColor: selected ? colors.primary : colors.border,
                        backgroundColor: selected ? colors.primarySoft : 'transparent',
                        opacity: pressed ? 0.8 : 1,
                      },
                    ]}
                  >
                    <Text style={[type.body, styles.flexShrink, { color: colors.text }]}>
                      {option.label}
                    </Text>
                    <Text style={[type.label, { color: colors.textMuted }]}>
                      {option.count}
                    </Text>
                  </Pressable>
                );
              })
            )}
          </ScrollView>

          <Button
            label="Clear"
            testID="filter-clear"
            variant="ghost"
            onPress={() => onChange({ statuses: [] })}
          />
          <Button label="Done" testID="filter-done" onPress={onClose} />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.45)' },
  list: { maxHeight: 280 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  flexShrink: { flexShrink: 1 },
});
