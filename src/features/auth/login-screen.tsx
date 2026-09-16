import { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useTheme } from '../../lib/theme/theme-provider';
import { env } from '../../lib/env';
import { Button } from '../../ui/Button';
import { Screen } from '../../ui/Screen';
import { useAuth } from './auth-context';

export function LoginScreen() {
  const { state, submitting, signIn } = useAuth();
  const { colors, radius, spacing, touch, type } = useTheme();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const error = state.status === 'signedOut' ? state.error : undefined;
  const canSubmit = email.trim().length > 0 && password.length > 0 && !submitting;
  const submit = () => {
    if (canSubmit) void signIn(email, password);
  };

  const inputStyle = [
    type.body,
    styles.input,
    {
      minHeight: touch.min,
      backgroundColor: colors.surface,
      borderColor: colors.border,
      borderRadius: radius.md,
      color: colors.text,
      paddingHorizontal: spacing.lg,
    },
  ];

  return (
    <Screen testID="login-screen" edges={['top', 'bottom', 'left', 'right']}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={[
            styles.body,
            { padding: spacing.xl, gap: spacing.md },
          ]}
        >
          <Text accessibilityRole="header" style={[type.display, styles.center, { color: colors.text }]}>
            BitCRM
          </Text>
          <Text style={[type.label, styles.center, { color: colors.textMuted, marginBottom: spacing.lg }]}>
            Technician sign in
          </Text>

          <TextInput
            accessibilityLabel="Email"
            style={inputStyle}
            placeholder="Email"
            placeholderTextColor={colors.textMuted}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            textContentType="username"
            value={email}
            onChangeText={setEmail}
            editable={!submitting}
          />
          <TextInput
            accessibilityLabel="Password"
            style={inputStyle}
            placeholder="Password"
            placeholderTextColor={colors.textMuted}
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry
            textContentType="password"
            value={password}
            onChangeText={setPassword}
            editable={!submitting}
            onSubmitEditing={submit}
          />

          {error ? (
            <Text
              accessibilityLiveRegion="assertive"
              style={[type.label, { color: colors.danger }]}
            >
              {error}
            </Text>
          ) : null}

          <Button
            label="Sign in"
            size="hero"
            onPress={submit}
            disabled={!canSubmit}
            busy={submitting}
            testID="sign-in"
          />

          {env.name === 'development' || env.usingDevGateway ? (
            <View style={{ marginTop: spacing.lg }}>
              <Text style={[type.caption, styles.center, { color: colors.warning }]}>
                Pointed at {env.apiBaseUrl}
              </Text>
            </View>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  body: { flexGrow: 1, justifyContent: 'center' },
  center: { textAlign: 'center' },
  input: { borderWidth: 2 },
});
