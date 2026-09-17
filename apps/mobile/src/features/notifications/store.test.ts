import AsyncStorage from '@react-native-async-storage/async-storage';
import { EMPTY_PUSH_STATE, loadPushState, recordAppOpen, savePushState } from './store';

const KEY = 'bitcrm.push.v1';

describe('push state on disk', () => {
  it('starts from nothing on a phone that has never run this', async () => {
    await expect(loadPushState()).resolves.toEqual(EMPTY_PUSH_STATE);
  });

  it('keeps a change without losing what was already there', async () => {
    await savePushState({ opens: 3 });
    await savePushState({ token: 'ExponentPushToken[abc]' });

    await expect(loadPushState()).resolves.toEqual({
      opens: 3,
      asked: false,
      token: 'ExponentPushToken[abc]',
    });
  });

  it('forgets the token when asked to, rather than writing an empty one', async () => {
    await savePushState({ token: 'ExponentPushToken[abc]', asked: true });
    await savePushState({ token: undefined });

    await expect(loadPushState()).resolves.toEqual({ opens: 0, asked: true });
  });

  it('counts opens across launches', async () => {
    await expect(recordAppOpen()).resolves.toBe(1);
    await expect(recordAppOpen()).resolves.toBe(2);
    await expect(loadPushState()).resolves.toMatchObject({ opens: 2 });
  });

  it('treats a half-written blob as nothing, rather than refusing to start', async () => {
    // The worst this can cost is one early permission prompt. Refusing to
    // start the app would cost a technician their day.
    await AsyncStorage.setItem(KEY, '{ not json');
    await expect(loadPushState()).resolves.toEqual(EMPTY_PUSH_STATE);

    await AsyncStorage.setItem(KEY, JSON.stringify({ opens: 'lots', token: 42 }));
    await expect(loadPushState()).resolves.toEqual(EMPTY_PUSH_STATE);
  });

  it('survives a disk that will not take the write', async () => {
    const setItem = AsyncStorage.setItem as jest.Mock;
    setItem.mockRejectedValueOnce(new Error('disk full'));

    await expect(savePushState({ opens: 1 })).resolves.toMatchObject({ opens: 1 });
  });
});
