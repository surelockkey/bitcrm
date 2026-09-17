import React from 'react';
import { render } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import {
  ThemeProvider,
  type ColorSchemeName,
} from '../lib/theme/theme-provider';

/** Fixed insets so a test never depends on a device's notch. */
const metrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

/** The providers every screen assumes: safe-area insets and a theme. */
export function AppProviders({
  children,
  scheme = 'light',
}: {
  children: React.ReactNode;
  scheme?: ColorSchemeName;
}) {
  return (
    <SafeAreaProvider initialMetrics={metrics}>
      <ThemeProvider scheme={scheme}>{children}</ThemeProvider>
    </SafeAreaProvider>
  );
}

/**
 * Renders a screen inside those providers. The scheme is a parameter so a
 * screen can be smoke-tested in both light and dark without the screen itself
 * knowing it is under test.
 */
export function renderScreen(
  ui: React.ReactElement,
  { scheme = 'light' }: { scheme?: ColorSchemeName } = {},
) {
  return render(<AppProviders scheme={scheme}>{ui}</AppProviders>);
}
