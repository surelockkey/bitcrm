import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../lib/theme/theme-provider';
import { Button } from './Button';

export interface EmptyStateProps {
  title: string;
  body?: string;
  /** Offered when there is something to do about it — usually "Try again". */
  actionLabel?: string;
  onAction?: () => void;
  tone?: 'neutral' | 'error';
  testID?: string;
}

/**
 * The state a screen shows when it has nothing to show — empty, failed, or
 * still waiting on a permission. Always says what happened AND what to do,
 * because "no data" on a phone in a basement is a question, not an answer.
 */
export function EmptyState({
  title,
  body,
  actionLabel,
  onAction,
  tone = 'neutral',
  testID,
}: EmptyStateProps) {
  const { colors, spacing, type } = useTheme();
  const ink = tone === 'error' ? colors.danger : colors.text;
  return (
    <View
      testID={testID}
      accessibilityLiveRegion="polite"
      style={[styles.wrap, { padding: spacing.xl, gap: spacing.md }]}
    >
      <Text style={[type.heading, styles.center, { color: ink }]}>{title}</Text>
      {body ? (
        <Text style={[type.body, styles.center, { color: colors.textMuted }]}>
          {body}
        </Text>
      ) : null}
      {actionLabel && onAction ? (
        <Button
          label={actionLabel}
          onPress={onAction}
          variant="secondary"
          style={styles.action}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', justifyContent: 'center' },
  center: { textAlign: 'center' },
  action: { alignSelf: 'stretch' },
});
