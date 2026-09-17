import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView, type Edge } from 'react-native-safe-area-context';
import { useTheme } from '../lib/theme/theme-provider';

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

/** A screen's own title bar — one line, large, and it wraps rather than clips. */
export function ScreenHeader({
  title,
  subtitle,
  right,
}: {
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
}) {
  const { colors, spacing, type } = useTheme();
  return (
    <View
      style={[
        styles.header,
        { paddingHorizontal: spacing.lg, paddingVertical: spacing.md, gap: spacing.md },
      ]}
    >
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
      {right}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  flexShrink: { flexShrink: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
});
