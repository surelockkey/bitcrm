import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView, type Edge } from 'react-native-safe-area-context';
import { useTheme } from '../lib/theme/theme-provider';
import { Button } from './Button';

/**
 * A page. Paints the theme's own background rather than inheriting whatever the
 * navigator hands down, so a dark screen never flashes white on push.
 */
export function Screen({
  children,
  edges = ['top', 'left', 'right'],
  testID,
}: {
  children: React.ReactNode;
  edges?: readonly Edge[];
  testID?: string;
}) {
  const { colors } = useTheme();
  return (
    <SafeAreaView
      testID={testID}
      edges={edges}
      style={[styles.flex, { backgroundColor: colors.background }]}
    >
      {children}
    </SafeAreaView>
  );
}

/**
 * A screen's own title bar — one line, large, and it wraps rather than clips.
 *
 * `onBack` draws the way out. Screens that used to be tabs are pushed over the
 * tab bar now, and a pushed screen with no visible Back leaves a technician
 * with only the phone's own gesture — which is a different gesture on each of
 * the two platforms, and on Android competes with the swipe that changes the
 * day. The word rather than a chevron, for the same reason every other action
 * in this app is a word.
 */
export function ScreenHeader({
  title,
  subtitle,
  right,
  onBack,
  backTestID = 'screen-back',
}: {
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
  onBack?: () => void;
  backTestID?: string;
}) {
  const { colors, spacing, type } = useTheme();
  return (
    <View
      style={[
        styles.header,
        { paddingHorizontal: spacing.lg, paddingVertical: spacing.md, gap: spacing.md },
      ]}
    >
      <View style={[styles.titles, { gap: spacing.md }]}>
        {onBack ? (
          <Button
            label="Back"
            variant="ghost"
            testID={backTestID}
            accessibilityHint="Goes back to the screen you came from"
            onPress={onBack}
          />
        ) : null}
        <View style={styles.flexShrink}>
          <Text
            accessibilityRole="header"
            style={[type.display, { color: colors.text }]}
          >
            {title}
          </Text>
          {subtitle ? (
            <Text style={[type.label, { color: colors.textMuted }]}>{subtitle}</Text>
          ) : null}
        </View>
      </View>
      {right}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  flexShrink: { flexShrink: 1 },
  titles: { flexDirection: 'row', alignItems: 'center', flexShrink: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
});
