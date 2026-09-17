import { StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../../../lib/theme/theme-provider';
import type { AudienceChrome } from '../lib';

/**
 * Who this thread reaches, said plainly, directly above the box that writes
 * into it.
 *
 * Both threads have one. That is the point: a single warning on the client
 * thread would leave the office thread as the one with nothing on it, and
 * "nothing on it" is not something a technician reads — they infer it, and
 * inferring is exactly what goes wrong at a doorstep in the rain. Two strips,
 * two sentences, two colours, and the sentence says which thread this is
 * rather than which it is not.
 *
 * The client's is warning-toned and the office's quiet, because the two
 * mistakes are not equal: a line meant for the office that reaches a client is
 * a phone call to the owner.
 */
export function AudienceStrip({ chrome }: { chrome: AudienceChrome }) {
  const { colors, radius, spacing, type } = useTheme();
  const client = chrome.audience === 'client';

  return (
    <View
      testID={`audience-${chrome.audience}`}
      accessibilityLiveRegion="polite"
      style={[
        styles.strip,
        {
          backgroundColor: client ? colors.warningSoft : colors.primarySoft,
          borderColor: client ? colors.warning : colors.primary,
          borderRadius: radius.md,
          marginHorizontal: spacing.lg,
          marginBottom: spacing.sm,
          paddingHorizontal: spacing.md,
          paddingVertical: spacing.sm,
        },
      ]}
    >
      <Text
        style={[type.caption, { color: client ? colors.warning : colors.primary }]}
      >
        {chrome.banner}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  strip: { borderWidth: 1 },
});
