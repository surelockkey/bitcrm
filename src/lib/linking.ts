import { Linking } from 'react-native';

/**
 * Hand a URL to whatever the phone uses for it — the Maps app for a directions
 * link, the dialler for a `tel:`.
 *
 * Resolves false rather than throwing: a technician tapping "Navigate" on a
 * phone with no maps app installed should see a message, not a crash.
 */
export async function openExternalUrl(url: string | null): Promise<boolean> {
  if (!url) return false;
  try {
    await Linking.openURL(url);
    return true;
  } catch {
    return false;
  }
}
