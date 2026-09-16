import { useEffect } from 'react';
import { Stack, type ErrorBoundaryProps } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider, useAuth } from '../src/features/auth/auth-context';
import { QueryProvider } from '../src/lib/query/query-provider';
import { ThemeProvider, useTheme } from '../src/lib/theme/theme-provider';
import { AppErrorBoundary, ErrorScreen } from '../src/ui/error-boundary';
import { Splash } from '../src/ui/Splash';

// Hold the native splash until we know whether there is a session, so the app
// never shows the login screen for a frame before restoring a signed-in tech.
void SplashScreen.preventAutoHideAsync().catch(() => {});

/**
 * expo-router renders this for a crash inside any route below the root. The
 * providers above the router are covered separately by `AppErrorBoundary`,
 * which is why the theme is re-established here — this component can be
 * rendered by the router outside our own tree.
 */
export function ErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <ErrorScreen error={error} retry={() => void retry()} />
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <AppErrorBoundary>
          <QueryProvider>
            <AuthProvider>
              <RootNavigator />
            </AuthProvider>
          </QueryProvider>
        </AppErrorBoundary>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

/**
 * The signed-in / signed-out split, declared rather than branched: `(app)`
 * exists only with a session and `(auth)/login` only without one, so a deep
 * link into a job while signed out lands on login instead of a blank screen,
 * and a 401 that ends the session takes the technician out of the job they
 * were looking at without any screen having to know about it.
 */
function RootNavigator() {
  const { state } = useAuth();
  const { colors, scheme } = useTheme();
  const restoring = state.status === 'loading';

  useEffect(() => {
    if (!restoring) void SplashScreen.hideAsync().catch(() => {});
  }, [restoring]);

  if (restoring) return <Splash />;

  const signedIn = state.status === 'signedIn';

  return (
    <>
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: colors.background },
        }}
      >
        <Stack.Protected guard={signedIn}>
          <Stack.Screen name="(app)" />
        </Stack.Protected>
        <Stack.Protected guard={!signedIn}>
          <Stack.Screen name="(auth)/login" />
        </Stack.Protected>
      </Stack>
    </>
  );
}
