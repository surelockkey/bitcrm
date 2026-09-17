import AsyncStorage from '@react-native-async-storage/async-storage';
import { clearProfile, loadProfile, saveProfile } from './profile-store';
import type { AuthUser } from './types';

const user: AuthUser = {
  id: 'u-1',
  email: 'tech@slk-s.com',
  firstName: 'Dana',
  roleId: 'role-technician',
};

describe('profile store', () => {
  it('returns nothing before anyone has signed in', async () => {
    await expect(loadProfile()).resolves.toBeNull();
  });

  it('survives a restart — that is the whole point of it', async () => {
    await saveProfile(user);
    await expect(loadProfile()).resolves.toEqual(user);
  });

  it('forgets the technician on sign-out', async () => {
    await saveProfile(user);
    await clearProfile();
    await expect(loadProfile()).resolves.toBeNull();
  });

  it('ignores a corrupt blob rather than handing back half a user', async () => {
    await AsyncStorage.setItem('bitcrm.profile.v1', '{not json');
    await expect(loadProfile()).resolves.toBeNull();
  });

  it('rejects a profile with no id — it would fetch the whole dispatch board', async () => {
    await AsyncStorage.setItem(
      'bitcrm.profile.v1',
      JSON.stringify({ email: 'tech@slk-s.com' }),
    );
    await expect(loadProfile()).resolves.toBeNull();
  });

  it('does not let a storage failure break signing in or out', async () => {
    const setItem = jest
      .spyOn(AsyncStorage, 'setItem')
      .mockRejectedValueOnce(new Error('disk full'));
    await expect(saveProfile(user)).resolves.toBeUndefined();
    setItem.mockRestore();

    const removeItem = jest
      .spyOn(AsyncStorage, 'removeItem')
      .mockRejectedValueOnce(new Error('disk full'));
    await expect(clearProfile()).resolves.toBeUndefined();
    removeItem.mockRestore();
  });
});
