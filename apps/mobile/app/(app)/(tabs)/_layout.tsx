import { router } from 'expo-router';
import { StyleSheet, View, type ColorValue } from 'react-native';
import { Tabs } from 'expo-router/js-tabs';
import { useTeamChatBadge } from '../../../src/features/messaging/hooks';
import { unreadBadge } from '../../../src/features/messaging/lib';
import { AppMenu } from '../../../src/features/profile/AppMenu';
import { TAB_ITEMS } from '../../../src/features/profile/app-nav';
import { useTheme } from '../../../src/lib/theme/theme-provider';
import { DrawerHost } from '../../../src/ui/Drawer';

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

/**
 * Three tabs and a menu — Workiz's own shape
 * (`docs/import/WORKIZ_APP_SCREENS_LIVE.md` §1–§2).
 *
 * There were five tabs here: My jobs, Messages, My stock, Queue, Profile. The
 * technicians this app is for have used Workiz for years and reach for the
 * third tab expecting Messages, so the bar is now exactly Workiz's three —
 * Home, Schedule, Messages — and everything else moved behind the burger.
 * Nothing became unreachable: each of those screens is one tap inside the
 * menu, and what the bar carried, the burger carries — a dot when this phone
 * is still holding work it has not sent, which was the Queue tab's badge.
 *
 * The order lives in `TAB_ITEMS`, where it is tested; this file draws it.
 */
export default function TabsLayout() {
  const { colors, type } = useTheme();
  const chat = useTeamChatBadge();

  return (
    <DrawerHost menu={<AppMenu onNavigate={(href) => router.push(href)} />}>
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
        {TAB_ITEMS.map((tab) => (
          <Tabs.Screen
            key={tab.name}
            name={tab.name}
            options={{
              title: tab.title,
              tabBarAccessibilityLabel: tab.title,
              // Unread from the office, kept where it was: it is the one number
              // on this bar a technician acts on.
              ...(tab.name === 'chat'
                ? {
                    tabBarBadge: unreadBadge(chat.data?.unreadByKind?.team),
                    tabBarBadgeStyle: {
                      backgroundColor: colors.primary,
                      color: colors.onAccent,
                    },
                  }
                : {}),
            }}
          />
        ))}
      </Tabs>
    </DrawerHost>
  );
}

const styles = StyleSheet.create({
  dot: { width: 14, height: 14, borderRadius: 7, borderWidth: 2 },
});
