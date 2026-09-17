import * as Haptics from 'expo-haptics';

/**
 * A technician may not hear a sound over a compressor and may not be able to
 * read the screen in the sun, so every action that lands (or fails) also
 * answers in the hand (docs/ARCHITECTURE.md §2.9).
 *
 * Haptics are a courtesy, never a dependency: a device without a taptic engine,
 * or with system haptics turned off, simply gets nothing.
 */
export function hapticSuccess(): void {
  void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(
    () => {},
  );
}

export function hapticWarning(): void {
  void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(
    () => {},
  );
}

export function hapticError(): void {
  void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(
    () => {},
  );
}
