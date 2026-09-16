import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { useTheme } from '../lib/theme/theme-provider';

/**
 * What fills the window between the native splash image going away and the
 * first real screen: the same background, so there is no flash of white.
 */
export function Splash() {
  const { colors } = useTheme();
  return (
    <View
      testID="splash"
      accessibilityLabel="Loading"
      style={[styles.fill, { backgroundColor: colors.background }]}
    >
      <ActivityIndicator size="large" color={colors.primary} />
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
