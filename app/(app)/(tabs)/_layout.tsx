import { StyleSheet, View, type ColorValue } from 'react-native';
import { Tabs } from 'expo-router/js-tabs';
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
      <Tabs.Screen name="queue" options={{ title: 'Queue' }} />
      <Tabs.Screen name="profile" options={{ title: 'Profile' }} />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  dot: { width: 14, height: 14, borderRadius: 7, borderWidth: 2 },
});
