import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../../../lib/theme/theme-provider';
import type { InboxRow } from '../inbox-lib';

export interface ConversationRowProps {
  row: InboxRow;
  onPress: (row: InboxRow) => void;
}

/**
 * One line of the conversation list.
 *
 * The tag after the name is not decoration. This list puts the office and a
 * client one under the other for the first time in this app, and the single
 * mistake the whole Messages screen must make impossible is a technician
 * opening the wrong one and typing "the gate code did not work, this is the
 * third time" at a customer. So the row says which it is in words — "Office",
 * "Client" — before it is opened, and the thread behind it says so again
 * above the box (`AudienceStrip`).
 *
 * Unread is carried by weight and a dot, never by colour alone, and the whole
 * row is one target the height of a gloved thumb.
 */
export function ConversationRow({ row, onPress }: ConversationRowProps) {
  const { colors, radius, spacing, touch, type } = useTheme();
  const office = row.audience === 'office';

  return (
    <Pressable
      testID={`conversation-${row.id}`}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel(row)}
      onPress={() => onPress(row)}
      style={({ pressed }) => [
        styles.row,
        {
          // A two-line row gets the full-width action's height: this is the
          // list a technician scrolls with a thumb, in a glove, standing up.
          minHeight: touch.primary,
          borderRadius: radius.md,
          borderColor: colors.border,
          backgroundColor: pressed ? colors.surfaceSunken : colors.surface,
          paddingHorizontal: spacing.lg,
          paddingVertical: spacing.md,
          gap: spacing.xs,
        },
      ]}
    >
      <View style={[styles.line, { gap: spacing.sm }]}>
        <Text
          numberOfLines={1}
          style={[
            type.body,
            styles.grow,
            { color: colors.text, fontWeight: row.unread ? '700' : '600' },
          ]}
        >
          {row.title}
        </Text>
        <Text style={[type.caption, { color: colors.textMuted }]}>{row.time}</Text>
      </View>

      <View style={[styles.line, { gap: spacing.sm }]}>
        <Text
          testID={`conversation-${row.id}-tag`}
          style={[
            type.caption,
            {
              color: office ? colors.primary : colors.textMuted,
              backgroundColor: office ? colors.primarySoft : colors.surfaceSunken,
              borderRadius: radius.pill,
              paddingHorizontal: spacing.sm,
              paddingVertical: 2,
              overflow: 'hidden',
            },
          ]}
        >
          {row.tag}
        </Text>
        <Text
          numberOfLines={1}
          style={[
            type.caption,
            styles.grow,
            { color: row.unread ? colors.text : colors.textMuted },
          ]}
        >
          {row.preview || 'No messages yet'}
        </Text>
        {row.unread ? (
          <View
            testID={`conversation-${row.id}-unread`}
            style={[styles.dot, { backgroundColor: colors.primary }]}
          />
        ) : null}
      </View>
    </Pressable>
  );
}

function accessibilityLabel(row: InboxRow): string {
  const parts = [`${row.title}, ${row.tag}`];
  if (row.preview) parts.push(row.preview);
  if (row.time) parts.push(row.time);
  if (row.unread) {
    parts.push(row.unreadCount > 0 ? `${row.unreadCount} unread` : 'unread');
  }
  return parts.join(', ');
}

const styles = StyleSheet.create({
  row: { borderWidth: 1, justifyContent: 'center' },
  line: { flexDirection: 'row', alignItems: 'center' },
  grow: { flexShrink: 1, flexGrow: 1 },
  dot: { width: 10, height: 10, borderRadius: 5 },
});
