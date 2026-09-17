import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../../../lib/theme/theme-provider';
import { Card } from '../../../ui/Card';
import { HeaderAction } from '../../../ui/AppHeader';

export interface WidgetProps {
  title: string;
  /** "Updated 4 minutes ago". */
  updated: string;
  onRefresh: () => void;
  refreshing?: boolean;
  /** The bottom-right link out of the widget, Workiz's `View all` (§3). */
  viewAllLabel?: string;
  onViewAll?: () => void;
  children: React.ReactNode;
  testID?: string;
}

/**
 * A dashboard card, in Workiz's own furniture (§3): a title, when it was last
 * right, something to refresh it with, and `View all` in the bottom-right
 * corner. The body is whatever the widget counts.
 *
 * The refresh is a labelled word rather than a circular-arrow glyph, like
 * every other action in this app, and the "updated" line is a polite live
 * region so a screen reader hears the new age after a refresh instead of
 * silence.
 */
export function Widget({
  title,
  updated,
  onRefresh,
  refreshing = false,
  viewAllLabel = 'View all',
  onViewAll,
  children,
  testID,
}: WidgetProps) {
  const { colors, spacing, type } = useTheme();

  return (
    <Card testID={testID} style={{ gap: spacing.md }}>
      <View style={[styles.top, { gap: spacing.md }]}>
        <View style={styles.flexShrink}>
          <Text
            accessibilityRole="header"
            style={[type.heading, { color: colors.text }]}
          >
            {title}
          </Text>
          <Text
            testID={testID ? `${testID}-updated` : undefined}
            accessibilityLiveRegion="polite"
            style={[type.caption, { color: colors.textMuted }]}
          >
            {updated}
          </Text>
        </View>
        <HeaderAction
          testID={testID ? `${testID}-refresh` : 'widget-refresh'}
          label={refreshing ? 'Refreshing' : 'Refresh'}
          hint={`Asks the office for the latest ${title.toLowerCase()}`}
          onPress={onRefresh}
        />
      </View>

      {children}

      {onViewAll ? (
        <View style={styles.viewAll}>
          <HeaderAction
            testID={testID ? `${testID}-view-all` : 'widget-view-all'}
            label={viewAllLabel}
            hint="Opens the full list"
            onPress={onViewAll}
          />
        </View>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  top: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  flexShrink: { flexShrink: 1 },
  viewAll: { alignItems: 'flex-end' },
});
