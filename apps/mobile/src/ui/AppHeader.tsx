import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../lib/theme/theme-provider';

/**
 * The bar at the top of a tab.
 *
 * Workiz's is burger · title · a row of icon buttons
 * (`docs/import/WORKIZ_APP_SCREENS_LIVE.md` §3, §4), and this is the same three
 * parts in the same order. What is ours is that the actions are *words*: the
 * technicians this app is for are older men reading a phone at arm's length,
 * and a row of unlabelled glyphs is a guessing game. Words also mean a screen
 * reader and a sighted user are told the same thing.
 *
 * The whole row wraps, so at a large font scale the actions drop under the
 * title instead of squeezing it to one character.
 */
export function AppHeader({
  title,
  subtitle,
  left,
  right,
  testID,
}: {
  title: string;
  subtitle?: string;
  /** Usually the burger. */
  left?: React.ReactNode;
  /** The screen's own actions. */
  right?: React.ReactNode;
  testID?: string;
}) {
  const { colors, spacing, type } = useTheme();
  return (
    <View
      testID={testID}
      style={[
        styles.bar,
        {
          paddingHorizontal: spacing.md,
          paddingVertical: spacing.sm,
          gap: spacing.sm,
        },
      ]}
    >
      {left}
      <View style={styles.titles}>
        <Text
          accessibilityRole="header"
          numberOfLines={2}
          style={[type.heading, { color: colors.text }]}
        >
          {title}
        </Text>
        {subtitle ? (
          <Text style={[type.caption, { color: colors.textMuted }]}>{subtitle}</Text>
        ) : null}
      </View>
      {right ? <View style={[styles.actions, { gap: spacing.xs }]}>{right}</View> : null}
    </View>
  );
}

/**
 * One of those words.
 *
 * `selected` is for an action that is also a state — the search field being
 * open — so the control says which it is rather than leaving the technician to
 * infer it from a field appearing somewhere else on the screen.
 */
export function HeaderAction({
  label,
  onPress,
  hint,
  selected,
  testID,
}: {
  label: string;
  onPress: () => void;
  hint?: string;
  selected?: boolean;
  testID?: string;
}) {
  const { colors, radius, spacing, touch, type } = useTheme();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={hint}
      accessibilityState={selected === undefined ? undefined : { selected }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.action,
        {
          minHeight: touch.min,
          borderRadius: radius.md,
          paddingHorizontal: spacing.sm,
          backgroundColor: selected ? colors.primarySoft : 'transparent',
          opacity: pressed ? 0.7 : 1,
        },
      ]}
    >
      <Text style={[type.label, { color: colors.primary }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' },
  titles: { flexGrow: 1, flexShrink: 1, minWidth: 120 },
  actions: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' },
  action: { alignItems: 'center', justifyContent: 'center', minWidth: 56 },
});
