import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../lib/theme/theme-provider';
import { Button } from './Button';
import { Screen } from './Screen';

/**
 * What a crash looks like to a technician: a sentence, the error text (so they
 * can read it down the phone to dispatch), and a button that puts the app back
 * on its feet without a force-quit.
 */
export function ErrorScreen({
  error,
  retry,
}: {
  error: Error;
  retry: () => void;
}) {
  const { colors, radius, spacing, type } = useTheme();
  return (
    <Screen testID="error-screen">
      <ScrollView contentContainerStyle={[styles.body, { padding: spacing.xl, gap: spacing.lg }]}>
        <Text style={[type.title, { color: colors.danger }]}>
          Something went wrong
        </Text>
        <Text style={[type.body, { color: colors.textMuted }]}>
          The screen stopped rather than showing you something wrong. Nothing
          you had queued has been lost — it is still on the phone.
        </Text>
        <View
          style={{
            backgroundColor: colors.surface,
            borderColor: colors.border,
            borderWidth: StyleSheet.hairlineWidth,
            borderRadius: radius.md,
            padding: spacing.lg,
          }}
        >
          <Text selectable style={[type.caption, { color: colors.text }]}>
            {error?.message || String(error)}
          </Text>
        </View>
        <Button label="Try again" onPress={retry} size="hero" />
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { flexGrow: 1, justifyContent: 'center' },
});

interface State {
  error: Error | null;
}

/**
 * Catches a render crash anywhere below it. `expo-router` has its own per-route
 * boundary; this one wraps the providers above the router, where a failure
 * would otherwise be a white screen with no way back.
 */
export class AppErrorBoundary extends React.Component<
  { children: React.ReactNode; onError?: (error: Error) => void },
  State
> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error): void {
    this.props.onError?.(error);
  }

  private reset = (): void => {
    this.setState({ error: null });
  };

  render(): React.ReactNode {
    const { error } = this.state;
    if (error) return <ErrorScreen error={error} retry={this.reset} />;
    return this.props.children;
  }
}
