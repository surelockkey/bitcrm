import { StyleSheet, View, type ColorValue } from 'react-native';
import { Tabs } from 'expo-router/js-tabs';
import { useTeamChatBadge } from '../../../src/features/messaging/hooks';
import { unreadBadge } from '../../../src/features/messaging/lib';
import { summarizeQueue, tabBadge } from '../../../src/features/queue/lib';
import { useQueue } from '../../../src/features/queue/queue-provider';
import { useTheme } from '../../../src/lib/theme/theme-provider';

/** A tab marker drawn from Views — no icon font, nothing extra to ship. */
function TabDot({ color, focused }: { color: ColorValue; focused: boolean }) {
  return (
    <View
      style={[
        styles.dot,
        { borderColor: color, backgroundColor: focused ? color : 'transparent' },
      ]}
    />
  );
}

export default function TabsLayout() {
  const { colors, type } = useTheme();
  const { records } = useQueue();
  const counts = summarizeQueue(records);
  const chat = useTeamChatBadge();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.border,
          // Room for a gloved thumb; the label is never the only cue.
          minHeight: 64,
        },
        tabBarLabelStyle: { fontSize: type.caption.fontSize, fontWeight: '600' },
        tabBarIcon: ({ color, focused }) => <TabDot color={color} focused={focused} />,
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'My jobs' }} />
      {/* Messages sits straight after the day list, as it does in Workiz's own
          menu and in the technician's web nav (`apps/web/lib/nav/nav-config.ts`
          TECHNICIAN_NAV: My Jobs, Messages, …). */}
      <Tabs.Screen
        name="chat"
        options={{
          title: 'Messages',
          tabBarBadge: unreadBadge(chat.data?.unreadByKind?.team),
          tabBarBadgeStyle: {
            backgroundColor: colors.primary,
            color: colors.onAccent,
          },
        }}
      />
      {/*
       * The van sits at the top level, as it does in the web's technician nav
       * (`apps/web/lib/nav/nav-config.ts` TECHNICIAN_NAV). Workiz has no van
       * screen in its app at all, so there is no Workiz tab order to match —
       * and a technician standing at the back doors needs it in one thumb,
       * not three taps down inside a menu.
       */}
      <Tabs.Screen name="stock" options={{ title: 'My stock' }} />
      <Tabs.Screen
        name="queue"
        options={{
          title: 'Queue',
          // What has not reached the server, visible from every screen — a
          // technician should never have to go looking to find that out.
          tabBarBadge: tabBadge(counts),
          tabBarBadgeStyle: {
            backgroundColor: counts.failed ? colors.danger : colors.primary,
            color: colors.onAccent,
          },
        }}
      />
      <Tabs.Screen name="profile" options={{ title: 'Profile' }} />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  dot: { width: 14, height: 14, borderRadius: 7, borderWidth: 2 },
});
