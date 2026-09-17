import { Text } from 'react-native';
import { screen, waitFor } from '@testing-library/react-native';
import { renderScreen } from '../../test/render';
import { AuthProvider, useAuth } from '../auth/auth-context';
import * as device from './device';

/**
 * The logout half of the device contract, tested where it can actually go
 * wrong: the order.
 *
 * `DELETE /api/messaging/devices/:token` is authenticated, so releasing the
 * token has to happen while there is still a session to release it with. A
 * refactor that tidied the release to the end of `signOut` would still pass a
 * test that only asked "was it called?" — and would leave the next technician
 * on a shared van phone getting the last one's jobs on their lock screen.
 */

jest.mock('./device');

// Kept out of the way: importing the real one at module load registers a
// device-token listener and warns about Expo Go, neither of which this is about.
jest.mock('expo-notifications', () => ({}));

const calls: string[] = [];

jest.mock('../auth/token-store', () => ({
  clearTokens: jest.fn(() => {
    calls.push('clearTokens');
    return Promise.resolve();
  }),
  getIdToken: jest.fn(() => null),
  getRefreshToken: jest.fn(() => null),
  loadTokens: jest.fn(() => Promise.resolve(null)),
  saveRefreshedTokens: jest.fn(() => Promise.resolve()),
  saveTokens: jest.fn(() => Promise.resolve()),
}));

jest.mock('../auth/api', () => ({
  getMe: jest.fn(() => Promise.resolve({ id: 't1', email: 'tech@slk-s.com' })),
  login: jest.fn(),
  refresh: jest.fn(),
}));

jest.mock('../auth/profile-store', () => ({
  clearProfile: jest.fn(() => Promise.resolve()),
  loadProfile: jest.fn(() => Promise.resolve(null)),
  saveProfile: jest.fn(() => Promise.resolve()),
}));

jest.mock('../../lib/query/client', () => ({
  resetAppCache: jest.fn(() => Promise.resolve()),
}));

const mockDevice = device as jest.Mocked<typeof device>;

function SignOutNow() {
  const { signOut, state } = useAuth();
  return (
    <Text
      testID="go"
      onPress={() => {
        void signOut();
      }}
    >
      {state.status}
    </Text>
  );
}

beforeEach(() => {
  calls.length = 0;
  mockDevice.releasePushDevice.mockImplementation(() => {
    calls.push('releasePushDevice');
    return Promise.resolve();
  });
});

describe('signing out', () => {
  it('takes the phone off the push list before the session it needs is gone', async () => {
    await renderScreen(
      <AuthProvider>
        <SignOutNow />
      </AuthProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('go')).toBeTruthy());

    screen.getByTestId('go').props.onPress();

    await waitFor(() => expect(calls).toContain('clearTokens'));
    expect(calls).toEqual(['releasePushDevice', 'clearTokens']);
  });

  it('signs the technician out even when the release fails', async () => {
    // A basement, or a server that has already forgotten the token. Being
    // unable to say goodbye must not trap someone in a session.
    mockDevice.releasePushDevice.mockImplementation(() =>
      Promise.reject(new Error('offline')),
    );

    await renderScreen(
      <AuthProvider>
        <SignOutNow />
      </AuthProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('go')).toBeTruthy());
    screen.getByTestId('go').props.onPress();

    await waitFor(() => expect(screen.getByTestId('go')).toHaveTextContent('signedOut'));
  });
});
