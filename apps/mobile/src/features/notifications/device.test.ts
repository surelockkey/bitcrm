import * as Notifications from 'expo-notifications';
import * as api from './api';
import { RELEASE_DEADLINE_MS, registerPushDevice, releasePushDevice } from './device';
import { loadPushState, savePushState } from './store';

jest.mock('./api');

const mockApi = api as jest.Mocked<typeof api>;
const mockNotifications = Notifications as jest.Mocked<typeof Notifications>;

/**
 * A real device, on iOS, in a build that has an EAS project id — i.e. the
 * world as it will be once the owner's accounts exist. Each test then takes
 * one leg away and checks the app still stands up.
 */
let mockIsDevice = true;
let mockProjectId: string | undefined = 'proj-1';

jest.mock('expo-device', () => ({
  get isDevice() {
    return mockIsDevice;
  },
  deviceName: 'Van 7 iPhone',
}));

jest.mock('expo-constants', () => ({
  __esModule: true,
  default: {
    get expoConfig() {
      return {
        version: '1.0.0',
        extra: mockProjectId ? { eas: { projectId: mockProjectId } } : {},
      };
    },
  },
}));

jest.mock('expo-notifications', () => ({
  getPermissionsAsync: jest.fn(),
  requestPermissionsAsync: jest.fn(),
  getExpoPushTokenAsync: jest.fn(),
  setNotificationChannelAsync: jest.fn(),
  AndroidImportance: { DEFAULT: 3 },
}));

const permissions = (granted: boolean, canAskAgain = true) =>
  ({ granted, canAskAgain, status: granted ? 'granted' : 'undetermined' }) as never;

beforeEach(() => {
  mockIsDevice = true;
  mockProjectId = 'proj-1';
  mockNotifications.getPermissionsAsync.mockResolvedValue(permissions(true));
  mockNotifications.requestPermissionsAsync.mockResolvedValue(permissions(true));
  mockNotifications.getExpoPushTokenAsync.mockResolvedValue({
    data: 'ExponentPushToken[abc]',
    type: 'expo',
  });
  mockApi.registerDevice.mockResolvedValue({
    token: 'ExponentPushToken[abc]',
    registeredAt: '2026-09-17T08:00:00.000Z',
  });
  mockApi.unregisterDevice.mockResolvedValue({ token: 'ExponentPushToken[abc]' });
});

describe('registerPushDevice — permission granted', () => {
  it('hands the server the token in the shape the contract names', async () => {
    const outcome = await registerPushDevice();

    expect(outcome).toEqual({ status: 'registered', token: 'ExponentPushToken[abc]' });
    expect(mockApi.registerDevice).toHaveBeenCalledWith({
      token: 'ExponentPushToken[abc]',
      platform: 'ios',
      appVersion: '1.0.0',
      deviceName: 'Van 7 iPhone',
    });
  });

  it('does not put the OS prompt up when permission is already there', async () => {
    await registerPushDevice();
    expect(mockNotifications.requestPermissionsAsync).not.toHaveBeenCalled();
  });

  it('remembers the token, so signing out can release it', async () => {
    await registerPushDevice();
    await expect(loadPushState()).resolves.toMatchObject({
      token: 'ExponentPushToken[abc]',
    });
  });

  it('re-registers on a later open, so the server can see the phone is alive', async () => {
    await registerPushDevice();
    await registerPushDevice();
    expect(mockApi.registerDevice).toHaveBeenCalledTimes(2);
  });
});

describe('registerPushDevice — asking at the right moment', () => {
  beforeEach(() => {
    mockNotifications.getPermissionsAsync.mockResolvedValue(permissions(false));
  });

  it('says nothing on the first open', async () => {
    await expect(registerPushDevice()).resolves.toEqual({ status: 'not-yet' });
    expect(mockNotifications.requestPermissionsAsync).not.toHaveBeenCalled();
  });

  it('asks on the second, once the technician has come back to the app', async () => {
    await registerPushDevice();
    mockNotifications.requestPermissionsAsync.mockResolvedValue(permissions(true));

    await expect(registerPushDevice()).resolves.toEqual({
      status: 'registered',
      token: 'ExponentPushToken[abc]',
    });
    expect(mockNotifications.requestPermissionsAsync).toHaveBeenCalledTimes(1);
  });

  it('counts the open even when it decides not to ask', async () => {
    await registerPushDevice();
    await expect(loadPushState()).resolves.toMatchObject({ opens: 1, asked: false });
  });
});

describe('registerPushDevice — permission denied', () => {
  it('keeps working and never asks again', async () => {
    mockNotifications.getPermissionsAsync.mockResolvedValue(permissions(false));
    mockNotifications.requestPermissionsAsync.mockResolvedValue(permissions(false));

    await registerPushDevice();
    await expect(registerPushDevice()).resolves.toEqual({ status: 'denied' });
    // Nothing was registered, and nothing threw.
    expect(mockApi.registerDevice).not.toHaveBeenCalled();

    // Their "no" stands on every open after it.
    await expect(registerPushDevice()).resolves.toEqual({ status: 'denied' });
    expect(mockNotifications.requestPermissionsAsync).toHaveBeenCalledTimes(1);
  });

  it('takes the OS refusing to ask again as an answer', async () => {
    mockNotifications.getPermissionsAsync.mockResolvedValue(permissions(false, false));

    await registerPushDevice();
    await expect(registerPushDevice()).resolves.toEqual({ status: 'denied' });
    expect(mockNotifications.requestPermissionsAsync).not.toHaveBeenCalled();
  });

  it('remembers it asked even if the app dies on top of the dialog', async () => {
    mockNotifications.getPermissionsAsync.mockResolvedValue(permissions(false));
    mockNotifications.requestPermissionsAsync.mockRejectedValue(new Error('killed'));

    await registerPushDevice();
    await registerPushDevice();
    await expect(loadPushState()).resolves.toMatchObject({ asked: true });
  });
});

describe('registerPushDevice — no development build, no accounts', () => {
  it('stops quietly when the build has no EAS project id', async () => {
    // Today's state of the app: the id arrives with the owner's Expo account.
    mockProjectId = undefined;

    await expect(registerPushDevice()).resolves.toEqual({
      status: 'unavailable',
      reason: 'no-project-id',
    });
    // Never even asked Expo for a token it could not mint.
    expect(mockNotifications.getExpoPushTokenAsync).not.toHaveBeenCalled();
    expect(mockApi.registerDevice).not.toHaveBeenCalled();
  });

  it('stops quietly when Expo will not mint a token (Expo Go, no credentials)', async () => {
    mockNotifications.getExpoPushTokenAsync.mockRejectedValue(
      new Error('No "projectId" found / not a development build'),
    );

    await expect(registerPushDevice()).resolves.toEqual({
      status: 'unavailable',
      reason: 'no-token',
    });
    expect(mockApi.registerDevice).not.toHaveBeenCalled();
  });

  it('stops quietly on a simulator, which is every first run', async () => {
    mockIsDevice = false;

    await expect(registerPushDevice()).resolves.toEqual({
      status: 'unavailable',
      reason: 'simulator',
    });
    expect(mockNotifications.getPermissionsAsync).not.toHaveBeenCalled();
  });
});

describe('registerPushDevice — the server or the network', () => {
  it('does not claim to be registered when the server never heard', async () => {
    mockApi.registerDevice.mockRejectedValue(new Error('502'));

    await expect(registerPushDevice()).resolves.toMatchObject({ status: 'failed' });
    // No stored token: the next open tries again rather than believing this.
    await expect(loadPushState()).resolves.not.toHaveProperty('token');
  });
});

describe('releasePushDevice', () => {
  it('takes the phone off the list and forgets the token', async () => {
    await registerPushDevice();
    await releasePushDevice();

    expect(mockApi.unregisterDevice).toHaveBeenCalledWith('ExponentPushToken[abc]');
    await expect(loadPushState()).resolves.not.toHaveProperty('token');
  });

  it('does nothing at all when there is nothing registered', async () => {
    await releasePushDevice();
    expect(mockApi.unregisterDevice).not.toHaveBeenCalled();
  });

  it('still forgets the token when the phone has no signal to say so', async () => {
    // Signing out in a basement signs you out. The server prunes the stale
    // token when a push to it bounces.
    await savePushState({ token: 'ExponentPushToken[abc]' });
    mockApi.unregisterDevice.mockRejectedValue(new Error('offline'));

    await expect(releasePushDevice()).resolves.toBeUndefined();
    await expect(loadPushState()).resolves.not.toHaveProperty('token');
  });

  it('gives up on a request that neither answers nor fails', async () => {
    /*
     * The worst network a technician has is not the absent one — that rejects
     * in milliseconds — it is the one bar on a site hoarding, where a socket
     * opens and nothing comes back. Nothing in `http.ts` puts a deadline on a
     * fetch, so without one here `signOut` awaits this forever and the person
     * who tapped "Sign out" stays inside the session.
     */
    jest.useFakeTimers();
    try {
      await savePushState({ token: 'ExponentPushToken[abc]' });
      mockApi.unregisterDevice.mockReturnValue(new Promise(() => {}));

      const released = releasePushDevice();
      await jest.advanceTimersByTimeAsync(RELEASE_DEADLINE_MS);

      await expect(released).resolves.toBeUndefined();
      await expect(loadPushState()).resolves.not.toHaveProperty('token');
    } finally {
      jest.useRealTimers();
    }
  });
});
