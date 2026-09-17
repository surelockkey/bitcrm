import { AppState, Text, type AppStateStatus } from 'react-native';
import { act } from 'react';
import {
  fireEvent,
  render as renderTree,
  screen,
  waitFor,
} from '@testing-library/react-native';
import * as Location from 'expo-location';
import { AppProviders } from '../../test/render';
import type { ClockState } from '../timeclock/lib';
import * as api from './api';
import { LocationSharingProvider, useLocationSharing } from './location-provider';
import { DEFAULT_SHARING_ENABLED, saveSharingPreference } from './settings';

/**
 * The four gates, one test each: on the clock, the switch, the phone, the app
 * being open. Any one of them false and nothing leaves the device.
 */

jest.mock('./api');

const mockRemove = jest.fn();
let mockReading: ((reading: { coords: { latitude: number; longitude: number; accuracy: number } }) => void) | undefined;

jest.mock('expo-location', () => ({
  Accuracy: { Balanced: 3 },
  getForegroundPermissionsAsync: jest.fn(),
  requestForegroundPermissionsAsync: jest.fn(),
  watchPositionAsync: jest.fn(),
}));

const mockApi = api as jest.Mocked<typeof api>;
const mockLocation = Location as jest.Mocked<typeof Location>;

let mockClock: ClockState = { status: 'off' };
jest.mock('../timeclock/hooks', () => ({
  useClockState: () => ({
    state: mockClock,
    failed: [],
    isLoading: false,
    refetch: jest.fn(),
  }),
}));

jest.mock('../auth/auth-context', () => ({
  useAuth: () => ({
    state: {
      status: 'signedIn',
      user: { id: 'tech-1', email: 'tech@slk-s.com' },
    },
    submitting: false,
    signIn: jest.fn(),
    signOut: jest.fn(),
  }),
}));

const onTheClock: ClockState = {
  status: 'on',
  entry: {
    id: 'e1',
    userId: 'tech-1',
    startedAt: new Date(Date.now() - 3_600_000).toISOString(),
    source: 'mobile',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
};

/** A window on the provider's state, and the switch, for the test to press. */
function Probe() {
  const { enabled, setEnabled, permission, isSharing } = useLocationSharing();
  return (
    <>
      <Text testID="enabled">{String(enabled)}</Text>
      <Text testID="permission">{permission}</Text>
      <Text testID="sharing">{String(isSharing)}</Text>
      <Text testID="turn-off" onPress={() => void setEnabled(false)}>
        off
      </Text>
    </>
  );
}

/**
 * The tree, built the same way twice, so a re-render is an update rather than a
 * remount — a remount would give the provider a fresh set of refs and hide the
 * very teardown these tests are about.
 */
const tree = () => (
  <AppProviders>
    <LocationSharingProvider>
      <Probe />
    </LocationSharingProvider>
  </AppProviders>
);

const render = () => renderTree(tree());

/**
 * Drive `AppState` by hand: `jest-expo` gives no emitter, so the listener the
 * provider registers is captured and called directly.
 */
function captureAppState(): (status: AppStateStatus) => void {
  const handlers: ((status: AppStateStatus) => void)[] = [];
  jest
    .spyOn(AppState, 'addEventListener')
    .mockImplementation((_type: string, cb: (status: AppStateStatus) => void) => {
      handlers.push(cb);
      return { remove: jest.fn() } as unknown as ReturnType<
        typeof AppState.addEventListener
      >;
    });
  return (status) => handlers.forEach((cb) => cb(status));
}

const granted = { granted: true, canAskAgain: false, status: 'granted' };
const refused = { granted: false, canAskAgain: false, status: 'denied' };
const unasked = { granted: false, canAskAgain: true, status: 'undetermined' };

beforeEach(() => {
  mockClock = { status: 'off' };
  mockReading = undefined;
  mockRemove.mockReset();
  mockApi.reportLocation.mockReset().mockResolvedValue({
    userId: 'tech-1',
    lat: 0,
    lng: 0,
    updatedAt: '',
  });
  mockApi.clearReportedLocation.mockReset().mockResolvedValue(undefined);
  mockLocation.getForegroundPermissionsAsync.mockReset().mockResolvedValue(granted as never);
  mockLocation.requestForegroundPermissionsAsync.mockReset().mockResolvedValue(granted as never);
  mockLocation.watchPositionAsync.mockReset().mockImplementation((_opts, cb) => {
    mockReading = cb as typeof mockReading;
    return Promise.resolve({ remove: mockRemove } as never);
  });
});

describe('nothing is sent off the clock', () => {
  it('starts no watcher for a technician who is not clocked in', async () => {
    await render();
    await waitFor(() =>
      expect(screen.getByTestId('permission')).toHaveTextContent('granted'),
    );
    expect(mockLocation.watchPositionAsync).not.toHaveBeenCalled();
    expect(screen.getByTestId('sharing')).toHaveTextContent('false');
  });
});

describe('on the clock, with permission and the switch on', () => {
  beforeEach(() => {
    mockClock = onTheClock;
  });

  it('watches, and reports what it sees', async () => {
    await render();
    await waitFor(() => expect(mockLocation.watchPositionAsync).toHaveBeenCalled());
    expect(screen.getByTestId('sharing')).toHaveTextContent('true');

    await act(async () => {
      mockReading?.({ coords: { latitude: 41.7637, longitude: -72.6851, accuracy: 9 } });
    });

    await waitFor(() =>
      expect(mockApi.reportLocation).toHaveBeenCalledWith('tech-1', {
        lat: 41.7637,
        lng: -72.6851,
        accuracy: 9,
      }),
    );
  });

  it('drops a reading the endpoint would refuse instead of 400-ing mid-shift', async () => {
    await render();
    await waitFor(() => expect(mockLocation.watchPositionAsync).toHaveBeenCalled());

    await act(async () => {
      mockReading?.({ coords: { latitude: 999, longitude: 0, accuracy: 9 } });
    });

    expect(mockApi.reportLocation).not.toHaveBeenCalled();
  });

  it('stops the moment the switch goes off, and takes the pin down with it', async () => {
    // The stored fix has no expiry: "off" has to mean the position is gone, not
    // frozen where the technician happened to be.
    await render();
    await waitFor(() => expect(mockLocation.watchPositionAsync).toHaveBeenCalled());

    await act(async () => {
      fireEvent.press(screen.getByTestId('turn-off'));
    });

    await waitFor(() => expect(mockRemove).toHaveBeenCalled());
    expect(screen.getByTestId('sharing')).toHaveTextContent('false');
    await waitFor(() =>
      expect(mockApi.clearReportedLocation).toHaveBeenCalledWith('tech-1'),
    );
  });

  it('remembers the refusal for next time', async () => {
    await render();
    await act(async () => {
      fireEvent.press(screen.getByTestId('turn-off'));
    });
    await waitFor(() =>
      expect(screen.getByTestId('enabled')).toHaveTextContent('false'),
    );
  });

  it('stops the instant the technician clocks out', async () => {
    // This is the promise the explainer makes, so it is the one that has to be
    // kept by code rather than by intention.
    const view = await render();
    await waitFor(() => expect(mockLocation.watchPositionAsync).toHaveBeenCalled());

    mockClock = { status: 'off' };
    await act(async () => {
      view.rerender(tree());
    });

    await waitFor(() => expect(mockRemove).toHaveBeenCalled());
    expect(screen.getByTestId('sharing')).toHaveTextContent('false');
    await waitFor(() =>
      expect(mockApi.clearReportedLocation).toHaveBeenCalledWith('tech-1'),
    );
  });

  it('stops when the app leaves the screen, rather than reporting from the background', async () => {
    const wake = captureAppState();
    await render();
    await waitFor(() => expect(mockLocation.watchPositionAsync).toHaveBeenCalled());

    await act(async () => {
      wake('background');
    });

    await waitFor(() => expect(mockRemove).toHaveBeenCalled());
  });

  it('keeps watching through a notification shade, which is not "closed"', async () => {
    // iOS reports `inactive` for transitions. Stopping and restarting the GPS
    // on each of them costs more battery than the tracking does.
    const wake = captureAppState();
    await render();
    await waitFor(() => expect(mockLocation.watchPositionAsync).toHaveBeenCalled());

    await act(async () => {
      wake('inactive');
    });

    expect(mockRemove).not.toHaveBeenCalled();
  });
});

describe('a technician who will not share their location', () => {
  it('is never watched, and the switch says the phone is blocking it', async () => {
    mockClock = onTheClock;
    mockLocation.getForegroundPermissionsAsync.mockResolvedValue(refused as never);

    await render();
    await waitFor(() =>
      expect(screen.getByTestId('permission')).toHaveTextContent('denied'),
    );
    expect(mockLocation.watchPositionAsync).not.toHaveBeenCalled();
    // The switch itself stays where the technician left it — the block is the
    // phone's, and the row says so rather than silently flipping.
    expect(screen.getByTestId('enabled')).toHaveTextContent(
      String(DEFAULT_SHARING_ENABLED),
    );
  });

  it('is not watched when they turned the switch off, whatever the phone allows', async () => {
    mockClock = onTheClock;
    await saveSharingPreference('tech-1', false);

    await render();
    await waitFor(() =>
      expect(screen.getByTestId('enabled')).toHaveTextContent('false'),
    );
    expect(mockLocation.watchPositionAsync).not.toHaveBeenCalled();
  });
});

describe('the explainer', () => {
  it('comes up before the phone is ever asked, once the clock is running', async () => {
    mockClock = onTheClock;
    mockLocation.getForegroundPermissionsAsync.mockResolvedValue(unasked as never);

    await render();

    await waitFor(() => expect(screen.getByTestId('location-consent')).toBeTruthy());
    // The system dialog cannot say who is asking or why, and it is shown once.
    expect(mockLocation.requestForegroundPermissionsAsync).not.toHaveBeenCalled();
  });

  it('asks the phone only after the technician has read it', async () => {
    mockClock = onTheClock;
    mockLocation.getForegroundPermissionsAsync.mockResolvedValue(unasked as never);

    await render();
    await waitFor(() => expect(screen.getByTestId('location-consent')).toBeTruthy());

    await act(async () => {
      fireEvent.press(screen.getByTestId('location-allow'));
    });

    await waitFor(() =>
      expect(mockLocation.requestForegroundPermissionsAsync).toHaveBeenCalled(),
    );
  });

  it('offers turning it off as an equal choice, and honours it', async () => {
    mockClock = onTheClock;
    mockLocation.getForegroundPermissionsAsync.mockResolvedValue(unasked as never);

    await render();
    await waitFor(() => expect(screen.getByTestId('location-consent')).toBeTruthy());

    await act(async () => {
      fireEvent.press(screen.getByTestId('location-turn-off'));
    });

    await waitFor(() =>
      expect(screen.getByTestId('enabled')).toHaveTextContent('false'),
    );
    expect(mockLocation.requestForegroundPermissionsAsync).not.toHaveBeenCalled();
  });

  it('does not come back for the rest of the shift once it has been answered', async () => {
    mockClock = onTheClock;
    mockLocation.getForegroundPermissionsAsync.mockResolvedValue(unasked as never);

    await render();
    await waitFor(() => expect(screen.getByTestId('location-consent')).toBeTruthy());

    await act(async () => {
      fireEvent.press(screen.getByTestId('location-not-now'));
    });

    // A sheet that reappears at every job is one technicians stop reading.
    await waitFor(() => expect(screen.queryByTestId('location-allow')).toBeNull());
  });
});
