import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  DEFAULT_SHARING_ENABLED,
  loadSharingPreference,
  saveSharingPreference,
} from './settings';

describe('the Location Tracking switch', () => {
  it('starts on, because the clock and the position are one feature for the office', () => {
    expect(DEFAULT_SHARING_ENABLED).toBe(true);
  });

  it('defaults for a technician who has never touched it', async () => {
    expect(await loadSharingPreference('tech-1')).toBe(DEFAULT_SHARING_ENABLED);
  });

  it('remembers a refusal across a restart', async () => {
    await saveSharingPreference('tech-1', false);
    expect(await loadSharingPreference('tech-1')).toBe(false);
  });

  it('is one technician’s decision, not the next one’s on the same van phone', async () => {
    await saveSharingPreference('tech-1', false);
    expect(await loadSharingPreference('tech-2')).toBe(DEFAULT_SHARING_ENABLED);
  });

  it('falls back to the documented default when storage will not answer', async () => {
    jest
      .spyOn(AsyncStorage, 'getItem')
      .mockRejectedValueOnce(new Error('disk full'));
    expect(await loadSharingPreference('tech-1')).toBe(DEFAULT_SHARING_ENABLED);
  });

  it('does not throw in the middle of switching it off', async () => {
    // The watcher has already stopped in memory; failing to write that down
    // must not take the tap with it.
    jest
      .spyOn(AsyncStorage, 'setItem')
      .mockRejectedValueOnce(new Error('disk full'));
    await expect(saveSharingPreference('tech-1', false)).resolves.toBeUndefined();
  });
});
