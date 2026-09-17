import { Stack } from 'expo-router';
import { PushProvider } from '../../src/features/notifications/push-provider';
import { useTheme } from '../../src/lib/theme/theme-provider';

/**
 * Everything behind the session. The tabs are one screen in this stack, so a
 * job detail (and its photo screen) pushes *over* the tab bar rather than
 * inside it — the way a deep link from a push notification should arrive.
 *
 * Push is wired here rather than at the root for the same reason this group
 * exists: a token registered against a technician only makes sense while there
 * is one signed in.
 */
export default function AppLayout() {
  const { colors } = useTheme();
  return (
    <PushProvider>
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: colors.background },
        }}
      />
    </PushProvider>
  );
}
