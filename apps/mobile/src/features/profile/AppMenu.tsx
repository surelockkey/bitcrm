import { Alert, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../../lib/theme/theme-provider';
import { DrawerDivider, DrawerRow, useDrawer } from '../../ui/Drawer';
import { useAuth } from '../auth/auth-context';
import { summarizeQueue, tabBadge } from '../queue/lib';
import { useQueue } from '../queue/queue-provider';
import { useClockBadge } from '../timeclock/hooks';
import {
  accountLine,
  displayName,
  drawerSections,
  menuBadge,
  type MenuItem,
} from './app-nav';

export interface AppMenuProps {
  /** Opens one of the screens the menu lists. */
  onNavigate: (href: string) => void;
}

/**
 * What is behind the burger.
 *
 * Workiz heads this menu with the avatar, the user's name large and the
 * account under it (`docs/import/WORKIZ_APP_SCREENS_LIVE.md` §2), and so does
 * this — minus the avatar, which we have no photo for and which would be an
 * empty grey circle. The rows and their order are `drawerSections`; this file
 * only draws them and says what each one does when pressed.
 *
 * Every row closes the menu before it navigates. A menu left open over the
 * screen it just opened is the commonest way a phone menu feels broken, and on
 * a `Modal` it would cover the screen entirely.
 */
export function AppMenu({ onNavigate }: AppMenuProps) {
  const { colors, spacing, type } = useTheme();
  const { state, signOut } = useAuth();
  const { close } = useDrawer();
  const { records } = useQueue();
  const clock = useClockBadge();

  const user = state.status === 'signedIn' ? state.user : null;
  const badges = { clock, outbox: tabBadge(summarizeQueue(records)) };
  const sections = drawerSections(badges);

  const press = (item: MenuItem) => {
    close();
    if (item.href) {
      onNavigate(item.href);
      return;
    }
    // The one row with no way back from a mis-tap. Everything this phone is
    // still holding goes out under this technician's name, so the question is
    // worth asking before the session ends.
    Alert.alert('Log out?', 'You will need your email and password to sign back in.', [
      { text: 'Stay signed in', style: 'cancel' },
      { text: 'Log out', style: 'destructive', onPress: () => void signOut() },
    ]);
  };

  return (
    <View testID="app-menu" style={{ gap: spacing.sm }}>
      <View
        testID="app-menu-account"
        accessibilityRole="header"
        style={[styles.account, { paddingHorizontal: spacing.md, gap: 2 }]}
      >
        <Text style={[type.title, { color: colors.text }]}>{displayName(user)}</Text>
        <Text style={[type.caption, { color: colors.textMuted }]}>
          {accountLine(user)}
        </Text>
      </View>

      {sections.map((section, index) => (
        <View key={section.key} style={{ gap: spacing.xs }}>
          {index > 0 ? <DrawerDivider /> : null}
          {section.items.map((item) => (
            <DrawerRow
              key={item.key}
              testID={`menu-${item.key}`}
              label={item.label}
              hint={item.hint}
              badge={menuBadge(item, badges)}
              tone={item.tone}
              onPress={() => press(item)}
            />
          ))}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  account: { paddingBottom: 4 },
});
