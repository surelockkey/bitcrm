import { ScrollView, StyleSheet, Text, View } from 'react-native';
import Constants from 'expo-constants';
import { useAuth } from '../auth/auth-context';
import { env } from '../../lib/env';
import { useTheme } from '../../lib/theme/theme-provider';
import { Button } from '../../ui/Button';
import { Card, CardRow } from '../../ui/Card';
import { Screen, ScreenHeader } from '../../ui/Screen';

/** Who am I signed in as, what build is this, and the way out. */
export function ProfileScreen() {
  const { state, signOut } = useAuth();
  const { colors, spacing, type } = useTheme();

  const user = state.status === 'signedIn' ? state.user : null;
  const name = user
    ? [user.firstName, user.lastName].filter(Boolean).join(' ') || user.email
    : '';

  return (
    <Screen testID="profile-screen">
      <ScreenHeader title="Profile" />
      <ScrollView
        contentContainerStyle={{ padding: spacing.lg, gap: spacing.lg }}
      >
        {user ? (
          <Card>
            <Text style={[type.heading, { color: colors.text }]}>{name}</Text>
            <CardRow label="Email" value={user.email} />
            {user.roleId ? (
              <CardRow label="Role" value={String(user.roleId)} />
            ) : null}
            {user.phone ? <CardRow label="Phone" value={String(user.phone)} /> : null}
          </Card>
        ) : null}

        <Card>
          <Text style={[type.label, { color: colors.textMuted }]}>Build</Text>
          <CardRow
            label="Version"
            value={String(Constants.expoConfig?.version ?? '—')}
          />
          <CardRow label="API" value={env.apiBaseUrl} />
          {env.usingApiOverride ? (
            <View>
              <Text style={[type.caption, { color: colors.warning }]}>
                This build is pointed at an override, not the shared gateway.
              </Text>
            </View>
          ) : null}
        </Card>

        <Button
          label="Sign out"
          variant="secondary"
          size="hero"
          onPress={() => void signOut()}
          testID="sign-out"
        />
        <View style={styles.spacer} />
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  spacer: { height: 24 },
});
