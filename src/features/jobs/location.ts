import * as Location from 'expo-location';

/**
 * "Arrived" must never hang on a fix that is not coming. A technician standing
 * at a door with one bar waits eight seconds at most, then the arrival is
 * recorded without coordinates — `MarkArrivedDto` accepts an empty body
 * (docs/ARCHITECTURE.md §1.2).
 */
export const GEOLOCATION_TIMEOUT_MS = 8_000;

/**
 * The widest radius the server will store (`MarkArrivedDto.accuracy`, `@Max`).
 * A network-derived fix can report hundreds of kilometres; that number is an
 * annotation, so it is dropped rather than allowed to 400 the arrival it
 * annotates.
 */
export const MAX_REPORTED_ACCURACY_M = 100_000;

export function reportableAccuracy(accuracy: number | null | undefined): boolean {
  return (
    typeof accuracy === 'number' &&
    Number.isFinite(accuracy) &&
    accuracy >= 0 &&
    accuracy <= MAX_REPORTED_ACCURACY_M
  );
}

export interface Fix {
  lat: number;
  lng: number;
  accuracy?: number;
}

/** Shape a raw reading into what the server accepts, dropping what it won't. */
export function toFix(coords: {
  latitude: number;
  longitude: number;
  accuracy?: number | null;
}): Fix {
  return {
    lat: coords.latitude,
    lng: coords.longitude,
    ...(reportableAccuracy(coords.accuracy) ? { accuracy: coords.accuracy! } : {}),
  };
}

/**
 * The phone's position, if it will give one, and a quick answer either way.
 *
 * Foreground permission only. Background location would force a custom dev
 * client, a Play Console declaration and an Apple review conversation, for a
 * feature v1 does not have (docs/STACK.md §2.2) — this asks once, at the
 * moment the technician taps "Arrived", which is also the easiest moment to
 * explain.
 */
export async function currentPosition(): Promise<Fix | undefined> {
  try {
    const { granted } = await Location.requestForegroundPermissionsAsync();
    if (!granted) return undefined;

    const timeout = new Promise<undefined>((resolve) => {
      setTimeout(() => resolve(undefined), GEOLOCATION_TIMEOUT_MS);
    });
    const reading = Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Balanced,
    }).then((position) => toFix(position.coords));

    return await Promise.race([reading, timeout]);
  } catch {
    // No GPS, permission revoked mid-flight, a driver that will not answer —
    // none of it is a reason to stop a technician recording that they arrived.
    return undefined;
  }
}
