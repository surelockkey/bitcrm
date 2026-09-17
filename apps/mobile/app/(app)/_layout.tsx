import { Stack } from 'expo-router';
import { useTheme } from '../../src/lib/theme/theme-provider';

/**
 * Everything behind the session. The tabs are one screen in this stack, so a
 * job detail (and its photo screen) pushes *over* the tab bar rather than
 * inside it — the way a deep link from a push notification should arrive.
 */
export default function AppLayout() {
  const { colors } = useTheme();
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.background },
      }}
    />
  );
}
