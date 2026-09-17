import { fireEvent, screen } from '@testing-library/react-native';
import { renderScreen } from '../../../test/render';
import type { LocationSharingValue } from '../location-provider';
import type { LocationPermission } from '../permission';
import { LocationSettingRow } from './LocationSettingRow';

const mockSetEnabled = jest.fn().mockResolvedValue(undefined);
const mockAskForConsent = jest.fn();
const mockOpenPhoneSettings = jest.fn().mockResolvedValue(true);

let mockSharing: LocationSharingValue;

jest.mock('../location-provider', () => ({
  useLocationSharing: () => mockSharing,
}));
jest.mock('../permission', () => ({
  openPhoneSettings: () => mockOpenPhoneSettings(),
}));

const sharing = (over: Partial<LocationSharingValue> = {}): LocationSharingValue => ({
  enabled: true,
  setEnabled: mockSetEnabled,
  permission: 'granted' as LocationPermission,
  requestPermission: jest.fn(),
  refreshPermission: jest.fn(),
  askForConsent: mockAskForConsent,
  isSharing: false,
  onTheClock: false,
  ...over,
});

beforeEach(() => {
  mockSetEnabled.mockClear();
  mockAskForConsent.mockClear();
  mockOpenPhoneSettings.mockClear();
  mockSharing = sharing();
});

const state = () =>
  screen.getByTestId('location-toggle-state', { includeHiddenElements: true });

describe('LocationSettingRow — Workiz’s "Location Tracking" (§1.12)', () => {
  it('is a switch a screen reader can read, and a word a thumb can', async () => {
    await renderScreen(<LocationSettingRow />);
    expect(screen.getByTestId('location-toggle')).toBeChecked();
    expect(state()).toHaveTextContent('On');
  });

  it('turns it off on a tap — and that is all it takes', async () => {
    await renderScreen(<LocationSettingRow />);
    await fireEvent.press(screen.getByTestId('location-toggle'));
    expect(mockSetEnabled).toHaveBeenCalledWith(false);
    // Nothing to explain when somebody is switching a thing off.
    expect(mockAskForConsent).not.toHaveBeenCalled();
  });

  it('explains itself before the phone is asked, when it is switched on', async () => {
    mockSharing = sharing({ enabled: false, permission: 'undetermined' });
    await renderScreen(<LocationSettingRow />);

    await fireEvent.press(screen.getByTestId('location-toggle'));

    expect(mockSetEnabled).toHaveBeenCalledWith(true);
    expect(mockAskForConsent).toHaveBeenCalledTimes(1);
  });

  it('does not re-explain to somebody who has already allowed it', async () => {
    mockSharing = sharing({ enabled: false, permission: 'granted' });
    await renderScreen(<LocationSettingRow />);

    await fireEvent.press(screen.getByTestId('location-toggle'));
    expect(mockAskForConsent).not.toHaveBeenCalled();
  });

  it('never claims to be on while the phone is refusing', async () => {
    // Workiz's own three levels: account, user, device. This row owns the
    // second and has to report honestly on the third.
    mockSharing = sharing({ enabled: true, permission: 'denied' });
    await renderScreen(<LocationSettingRow />);

    expect(state()).toHaveTextContent('Blocked');
    expect(screen.getByTestId('location-blocked')).toHaveTextContent(
      /You can still clock in and out/,
    );
  });

  it('offers the way to fix it, which is not in this app', async () => {
    mockSharing = sharing({ enabled: true, permission: 'denied' });
    await renderScreen(<LocationSettingRow />);

    await fireEvent.press(screen.getByTestId('location-open-settings'));
    expect(mockOpenPhoneSettings).toHaveBeenCalledTimes(1);
  });

  it('says when points are actually going out, not just that it is allowed to', async () => {
    mockSharing = sharing({ isSharing: true, onTheClock: true });
    await renderScreen(<LocationSettingRow />);
    expect(state()).toHaveTextContent('Sharing now');
  });
});
