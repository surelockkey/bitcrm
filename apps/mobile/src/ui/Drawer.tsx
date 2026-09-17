import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '../lib/theme/theme-provider';
import { Button } from './Button';

/**
 * The menu behind the burger.
 *
 * Workiz's app has exactly three bottom tabs and puts everything else here
 * (`docs/import/WORKIZ_APP_SCREENS_LIVE.md` §1–§2), so this is where five tabs'
 * worth of screens went. It is a `Modal` rather than a gesture-driven panel on
 * purpose: the gesture libraries a drawer navigator needs (Reanimated,
 * Gesture Handler) are not in this app, and a menu a technician opens a few
 * times a day is not worth two native dependencies and an Expo prebuild. What
 * it costs is the edge-swipe to open; what it keeps is every other way in.
 *
 * Three ways out, because this covers the whole screen: the scrim, an explicit
 * Close button, and `onRequestClose` — which is the Android hardware back
 * button and the Escape key. The last one is what makes the menu keyboard-
 * operable: the burger and every row are `Pressable`s with a button role, so a
 * hardware keyboard reaches them with Tab and fires them with Enter, and
 * Escape backs out without needing to find the Close button first.
 */

export interface DrawerApi {
  visible: boolean;
  open: () => void;
  close: () => void;
}

const inert: DrawerApi = { visible: false, open: () => {}, close: () => {} };

/**
 * Defaults to a no-op rather than throwing, so a screen carrying a burger can
 * be rendered — and tested — on its own, without the shell around it.
 */
const DrawerContext = createContext<DrawerApi>(inert);

export function useDrawer(): DrawerApi {
  return useContext(DrawerContext);
}

export interface DrawerHostProps {
  /** What the menu shows. Rendered inside the provider, so rows can close it. */
  menu: React.ReactNode;
  /** A screen-reader name for the panel itself. */
  label?: string;
  children: React.ReactNode;
}

/** Wraps the tabs: the menu overlays them, including the tab bar. */
export function DrawerHost({ menu, label = 'Menu', children }: DrawerHostProps) {
  const { colors, spacing } = useTheme();
  const [visible, setVisible] = useState(false);

  const open = useCallback(() => setVisible(true), []);
  const close = useCallback(() => setVisible(false), []);
  const api = useMemo<DrawerApi>(() => ({ visible, open, close }), [visible, open, close]);

  return (
    <DrawerContext.Provider value={api}>
      {children}
      <Modal
        visible={visible}
        transparent
        animationType="fade"
        onRequestClose={close}
        testID="drawer-modal"
      >
        <View style={styles.overlay}>
          <SafeAreaView
            edges={['top', 'left', 'bottom']}
            style={[styles.panel, { backgroundColor: colors.background }]}
          >
            <View
              testID="drawer-panel"
              accessibilityViewIsModal
              accessibilityLabel={label}
              style={[styles.panelBody, { borderRightColor: colors.border }]}
            >
              <View style={{ paddingHorizontal: spacing.lg, paddingTop: spacing.md }}>
                <Button
                  label="Close"
                  testID="drawer-close"
                  variant="ghost"
                  accessibilityHint="Closes the menu"
                  onPress={close}
                />
              </View>
              <ScrollView
                contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }}
              >
                {menu}
              </ScrollView>
            </View>
          </SafeAreaView>

          {/* The dead half of the screen. A button rather than a bare View so a
              screen reader announces a way out instead of skipping it. */}
          <Pressable
            testID="drawer-scrim"
            accessibilityRole="button"
            accessibilityLabel="Close the menu"
            onPress={close}
            style={styles.scrim}
          />
        </View>
      </Modal>
    </DrawerContext.Provider>
  );
}

/**
 * The burger.
 *
 * `marked` puts a dot on it — the one thing the menu holds that a technician
 * must not have to go looking for: work this phone has not managed to send.
 * The old tab bar carried that count on a Queue tab; the dot is what replaces
 * it now that the queue lives behind the menu, and the number itself is on the
 * row inside.
 */
export function MenuButton({
  marked = false,
  testID = 'open-menu',
}: {
  marked?: boolean;
  testID?: string;
}) {
  const { colors, radius, touch } = useTheme();
  const { open } = useDrawer();

  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={marked ? 'Menu, something is waiting to send' : 'Menu'}
      accessibilityHint="Opens Timesheets, Jobs, My stock and Settings"
      onPress={open}
      style={({ pressed }) => [
        styles.burger,
        {
          minWidth: touch.min,
          minHeight: touch.min,
          borderRadius: radius.md,
          opacity: pressed ? 0.7 : 1,
        },
      ]}
    >
      {/* Three bars drawn from Views — no icon font, nothing extra to ship. */}
      <View style={styles.bars} importantForAccessibility="no-hide-descendants">
        {[0, 1, 2].map((i) => (
          <View key={i} style={[styles.bar, { backgroundColor: colors.text }]} />
        ))}
      </View>
      {marked ? (
        <View
          testID="menu-dot"
          style={[styles.dot, { backgroundColor: colors.warning }]}
        />
      ) : null}
    </Pressable>
  );
}

/** A tappable line in the menu: a word, a reason, and sometimes a count. */
export function DrawerRow({
  label,
  hint,
  badge,
  tone = 'default',
  onPress,
  testID,
}: {
  label: string;
  hint?: string;
  badge?: string;
  tone?: 'default' | 'danger';
  onPress: () => void;
  testID?: string;
}) {
  const { colors, radius, spacing, touch, type } = useTheme();
  const ink = tone === 'danger' ? colors.danger : colors.text;

  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={badge ? `${label}, ${badge}` : label}
      accessibilityHint={hint}
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        {
          minHeight: touch.min,
          borderRadius: radius.md,
          paddingHorizontal: spacing.md,
          gap: spacing.md,
          backgroundColor: pressed ? colors.surface : 'transparent',
        },
      ]}
    >
      <Text style={[type.body, styles.rowLabel, { color: ink }]}>{label}</Text>
      {badge ? (
        <Text
          testID={testID ? `${testID}-badge` : undefined}
          style={[
            type.caption,
            styles.badge,
            {
              backgroundColor: colors.primarySoft,
              color: colors.text,
              borderRadius: radius.pill,
              paddingHorizontal: spacing.sm,
              paddingVertical: 2,
            },
          ]}
        >
          {badge}
        </Text>
      ) : null}
    </Pressable>
  );
}

/** The rule between two groups of rows. */
export function DrawerDivider() {
  const { colors, spacing } = useTheme();
  return (
    <View
      style={[
        styles.divider,
        { backgroundColor: colors.border, marginVertical: spacing.sm },
      ]}
    />
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, flexDirection: 'row' },
  // Wide enough for the longest row at a large font scale, capped so the scrim
  // stays a real target on a tablet.
  panel: { flexGrow: 1, flexShrink: 1, flexBasis: '82%', maxWidth: 360 },
  panelBody: { flex: 1, borderRightWidth: StyleSheet.hairlineWidth },
  scrim: { flexGrow: 1, backgroundColor: 'rgba(0,0,0,0.45)' },
  burger: { alignItems: 'center', justifyContent: 'center' },
  bars: { gap: 4 },
  bar: { width: 22, height: 2.5, borderRadius: 2 },
  dot: { position: 'absolute', top: 12, right: 12, width: 10, height: 10, borderRadius: 5 },
  row: { flexDirection: 'row', alignItems: 'center' },
  rowLabel: { flexShrink: 1 },
  badge: { overflow: 'hidden' },
  divider: { height: StyleSheet.hairlineWidth },
});
