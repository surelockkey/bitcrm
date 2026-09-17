import { ScrollView, StyleSheet, Text, View } from 'react-native';
import Constants from 'expo-constants';
import { useAuth } from '../auth/auth-context';
import { env } from '../../lib/env';
import { useTheme } from '../../lib/theme/theme-provider';
import { Button } from '../../ui/Button';
import { Card, CardRow } from '../../ui/Card';
import { Screen, ScreenHeader } from '../../ui/Screen';
import { LocationSettingRow } from '../location/components/LocationSettingRow';
import { useClockBadge } from '../timeclock/hooks';

export interface ProfileScreenProps {
  /** Workiz's Menu → Timesheets (`WORKIZ_MOBILE_APP.md` §1.12). */
  onOpenTimesheet?: () => void;
  /** Drawn as Back: this is pushed off the menu now rather than being a tab. */
  onBack?: () => void;
  /**
   * Which of the menu's two account rows opened this.
   *
   * Workiz's menu ends Settings · Get Help · Log out and has no profile screen
   * at all — the name and the account are the menu's own header
   * (`docs/import/WORKIZ_APP_SCREENS_LIVE.md` §2, §10). Ours keeps both rows,
   * so `settings` is exactly what Workiz keeps under that word: the controls,
   * with no identity card to scroll past and no Sign out button sitting a
   * finger's width from the Log out row in the menu behind it.
   */
  variant?: 'profile' | 'settings';
}

/**
 * Who am I signed in as, what build is this, and the way out — plus the two
 * settings Workiz keeps in the same menu.
 *
 * Workiz's Settings screen is App language, **Location Tracking**,
 * **Timesheets**, Log out (§1.12). This app has no language switch (English
 * only for now), so the order below is the rest of that list, unchanged: a
 * technician who has used Workiz for years finds both where they left them.
 */
export function ProfileScreen({
  onOpenTimesheet,
  onBack,
  variant = 'profile',
}: ProfileScreenProps = {}) {
  const { state, signOut } = useAuth();
  const { colors, spacing, type } = useTheme();
  const clock = useClockBadge();

  const settingsOnly = variant === 'settings';
  const user = state.status === 'signedIn' ? state.user : null;
  const name = user
    ? [user.firstName, user.lastName].filter(Boolean).join(' ') || user.email
    : '';

  return (
    <Screen testID="profile-screen">
      <ScreenHeader title={settingsOnly ? 'Settings' : 'Profile'} onBack={onBack} />
      <ScrollView
        contentContainerStyle={{ padding: spacing.lg, gap: spacing.lg }}
      >
        {user && !settingsOnly ? (
          <Card>
            <Text style={[type.heading, { color: colors.text }]}>{name}</Text>
            <CardRow label="Email" value={user.email} />
            {user.roleId ? (
              <CardRow label="Role" value={String(user.roleId)} />
            ) : null}
            {user.phone ? <CardRow label="Phone" value={String(user.phone)} /> : null}
          </Card>
        ) : null}

        <View style={{ gap: spacing.md }}>
          {/* The screen's own title already says it when this *is* Settings. */}
          {settingsOnly ? null : (
            <Text
              accessibilityRole="header"
              style={[type.heading, { color: colors.textMuted }]}
            >
              Settings
            </Text>
          )}
          <LocationSettingRow />
          {onOpenTimesheet ? (
            <Button
              label="Timesheet"
              testID="open-timesheet"
              variant="secondary"
              // The running clock said in words, for a technician who would not
              // read a number on a tab. Nothing when off the clock — a hint
              // that is always there stops being read.
              hint={
                clock
                  ? `On the clock — ${clock}`
                  : 'Clock in and out, and your hours this week'
              }
              onPress={onOpenTimesheet}
            />
          ) : null}
        </View>

        <Card>
          <Text style={[type.label, { color: colors.textMuted }]}>Build</Text>
          <CardRow
            label="Version"
            value={String(Constants.expoConfig?.version ?? '—')}
          />
          <CardRow label="API" value={env.apiBaseUrl} />
          {env.usingDevGateway ? (
            <View>
              <Text style={[type.caption, { color: colors.warning }]}>
                {env.name === 'production'
                  ? 'This release build is pointed at the shared DEV gateway. Jobs shown here are not real.'
                  : 'Development build, talking to the shared dev gateway.'}
              </Text>
            </View>
          ) : null}
        </Card>

        {settingsOnly ? null : (
          <Button
            label="Sign out"
            variant="secondary"
            size="hero"
            onPress={() => void signOut()}
            testID="sign-out"
          />
        )}
        <View style={styles.spacer} />
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  spacer: { height: 24 },
});
