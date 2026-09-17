import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../../../lib/theme/theme-provider';

/** The two tabs a Workiz job card has, in their order (§1.4). */
export const JOB_TABS = ['Details', 'Finance'] as const;
export type JobTab = (typeof JOB_TABS)[number];

/**
 * Details | Finance — the job card's own two tabs.
 *
 * Their words and their order. A technician of twenty years opens a job and
 * finds the same two labels in the same place, so nothing about the day has to
 * be relearned; what changes is only how they are drawn.
 *
 * Kept as a segmented strip rather than a swipeable pager: Finance is read-only
 * for now, and a horizontal swipe on a screen that already scrolls is how a
 * gloved thumb changes tab by accident.
 */
export function JobTabs({
  value,
  onChange,
}: {
  value: JobTab;
  onChange: (tab: JobTab) => void;
}) {
  const { colors, radius, spacing, touch, type } = useTheme();

  return (
    <View
      accessibilityRole="tablist"
      style={[
        styles.strip,
        {
          backgroundColor: colors.surfaceSunken,
          borderColor: colors.border,
          borderRadius: radius.md,
          padding: spacing.xs,
          gap: spacing.xs,
        },
      ]}
    >
      {JOB_TABS.map((tab) => {
        const selected = tab === value;
        return (
          <Pressable
            key={tab}
            testID={`job-tab-${tab.toLowerCase()}`}
            accessibilityRole="tab"
            accessibilityLabel={tab}
            accessibilityState={{ selected }}
            onPress={() => onChange(tab)}
            style={({ pressed }) => [
              styles.tab,
              {
                minHeight: touch.min,
                borderRadius: radius.sm,
                // Selection is carried by the fill AND by the weight of the
                // word, so it survives a washed-out screen in direct sun.
                backgroundColor: selected ? colors.surface : 'transparent',
                borderColor: selected ? colors.primary : 'transparent',
                opacity: pressed ? 0.82 : 1,
              },
            ]}
          >
            <Text
              style={[
                selected ? type.heading : type.body,
                { color: selected ? colors.text : colors.textMuted },
              ]}
            >
              {tab}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  strip: { flexDirection: 'row', borderWidth: StyleSheet.hairlineWidth },
  tab: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
  },
});
