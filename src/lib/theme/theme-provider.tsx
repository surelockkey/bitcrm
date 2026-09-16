import React, { createContext, useContext, useMemo } from 'react';
import { useColorScheme } from 'react-native';
import {
  darkColors,
  lightColors,
  radius,
  spacing,
  touch,
  type,
  type ThemeColors,
} from './tokens';

export type ColorSchemeName = 'light' | 'dark';

export interface Theme {
  scheme: ColorSchemeName;
  colors: ThemeColors;
  spacing: typeof spacing;
  radius: typeof radius;
  touch: typeof touch;
  type: typeof type;
}

export function buildTheme(scheme: ColorSchemeName): Theme {
  return {
    scheme,
    colors: scheme === 'dark' ? darkColors : lightColors,
    spacing,
    radius,
    touch,
    type,
  };
}

const lightTheme = buildTheme('light');
const darkTheme = buildTheme('dark');

const ThemeContext = createContext<Theme>(lightTheme);

/**
 * Follows the phone's own light/dark setting. `scheme` overrides it — tests
 * pass it to render both themes, and it is the seam a future in-app "always
 * dark" toggle plugs into without touching a single screen.
 */
export function ThemeProvider({
  children,
  scheme,
}: {
  children: React.ReactNode;
  scheme?: ColorSchemeName;
}) {
  const system = useColorScheme();
  const resolved: ColorSchemeName = scheme ?? (system === 'dark' ? 'dark' : 'light');
  const value = useMemo(
    () => (resolved === 'dark' ? darkTheme : lightTheme),
    [resolved],
  );
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): Theme {
  return useContext(ThemeContext);
}
