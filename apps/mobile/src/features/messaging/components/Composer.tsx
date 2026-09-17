import { StyleSheet, Text, TextInput, View } from 'react-native';
import { SMS_BODY_MAX_LENGTH } from '@bitcrm/types';
import { useTheme } from '../../../lib/theme/theme-provider';
import { Button } from '../../../ui/Button';

/**
 * The server's own ceiling for an in-app line (`SendMessageDto.body` is
 * validated against it — `send-message.dto.ts:96`). Enforced in the box rather
 * than discovered on the way out: a queued line the server refuses with a 400
 * is classified permanent, so it parks as "Not sent" for ever, and the words
 * are then only readable inside a bubble nobody can copy from.
 */
export const COMPOSER_MAX_LENGTH = SMS_BODY_MAX_LENGTH;

export interface ComposerProps {
  value: string;
  onChangeText: (text: string) => void;
  onSend: () => void;
  /** Written under the box: what will happen to the line when it is sent. */
  hint?: string;
  busy?: boolean;
}

/**
 * Writing to the office.
 *
 * The box grows with the text and never scrolls away from the Send button,
 * which keeps its full 56 dp however little has been typed — this is used
 * one-handed, in gloves, standing up (docs/ARCHITECTURE.md §2.9). Send is
 * disabled on an empty box and on whitespace alone, so a mis-tap cannot put a
 * blank line in front of dispatch.
 */
export function Composer({ value, onChangeText, onSend, hint, busy }: ComposerProps) {
  const { colors, radius, spacing, touch, type } = useTheme();

  return (
    <View
      style={[
        styles.wrap,
        {
          backgroundColor: colors.surface,
          borderTopColor: colors.border,
          padding: spacing.lg,
          gap: spacing.md,
        },
      ]}
    >
      <TextInput
        testID="chat-input"
        accessibilityLabel="Message to the office"
        multiline
        maxLength={COMPOSER_MAX_LENGTH}
        placeholder="Write to the office"
        placeholderTextColor={colors.textMuted}
        value={value}
        onChangeText={onChangeText}
        style={[
          type.body,
          {
            minHeight: touch.min,
            maxHeight: 140,
            backgroundColor: colors.background,
            borderColor: colors.border,
            borderWidth: 2,
            borderRadius: radius.md,
            color: colors.text,
            padding: spacing.md,
            textAlignVertical: 'top',
          },
        ]}
      />
      <Button
        label="Send"
        testID="chat-send"
        disabled={value.trim().length === 0}
        busy={busy}
        onPress={onSend}
      />
      {hint ? (
        <Text style={[type.caption, { color: colors.textMuted }]}>{hint}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { borderTopWidth: StyleSheet.hairlineWidth },
});
