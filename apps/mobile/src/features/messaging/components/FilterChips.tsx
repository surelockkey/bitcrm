import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../../../lib/theme/theme-provider';
import {
  chipAccessibilityLabel,
  chipLabel,
  type ChipCount,
  type InboxCategory,
} from '../inbox-lib';

export interface FilterChipsProps {
  categories: readonly InboxCategory[];
  counts: Record<InboxCategory, ChipCount>;
  value: InboxCategory;
  onChange: (category: InboxCategory) => void;
}

/**
 * The row of filters under the Messages header — `All (0)` · `Requests (0)` ·
 * `Clients (0)` · `Team (0)`, in Workiz's order and Workiz's words, read off
 * the live app (`WORKIZ_APP_SCREENS_LIVE.md` §5).
 *
 * Two things carry the state, never one: the chip fills **and** its label goes
 * bold. Colour alone would be the only cue for a man with a cracked screen in
 * direct sun, and this row is the first thing his thumb lands on.
 *
 * The unread dot is drawn next to the count rather than replacing it, because
 * the number in the brackets is the size of the category — that is what Workiz
 * prints — and "how many are new" is a different question with a different
 * answer. The screen reader is told both; a dot says nothing out loud.
 */
export function FilterChips({ categories, counts, value, onChange }: FilterChipsProps) {
  const { colors, radius, spacing, touch, type } = useTheme();

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      // The chips must never be the reason the whole list bounces sideways.
      contentContainerStyle={{
        paddingHorizontal: spacing.lg,
        gap: spacing.sm,
        paddingBottom: spacing.sm,
      }}
    >
      {categories.map((category) => {
        const count = counts[category];
        const selected = category === value;
        return (
          <Pressable
            key={category}
            testID={`chip-${category}`}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            accessibilityLabel={chipAccessibilityLabel(category, count)}
            onPress={() => onChange(category)}
            style={({ pressed }) => [
              styles.chip,
              {
                minHeight: touch.min,
                borderRadius: radius.pill,
                paddingHorizontal: spacing.md,
                gap: spacing.xs,
                borderColor: selected ? colors.primary : colors.border,
                backgroundColor: selected
                  ? colors.primarySoft
                  : pressed
                    ? colors.surfaceSunken
                    : colors.surface,
              },
            ]}
          >
            <Text
              style={[
                type.label,
                {
                  color: selected ? colors.primary : colors.text,
                  fontWeight: selected ? '700' : '500',
                },
              ]}
            >
              {chipLabel(category, count)}
            </Text>
            {count.unread > 0 ? (
              <View
                testID={`chip-${category}-unread`}
                style={[styles.dot, { backgroundColor: colors.primary }]}
              />
            ) : null}
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  dot: { width: 8, height: 8, borderRadius: 4 },
});
