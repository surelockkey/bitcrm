import { fireEvent, screen } from '@testing-library/react-native';
import { renderScreen } from '../../test/render';
import { ProfileScreen } from './profile-screen';
import type { AuthState } from '../auth/auth-reducer';

const mockSignOut = jest.fn();
const mockState: AuthState = {
  status: 'signedIn',
  user: {
    id: 'u-1',
    email: 'tech@slk-s.com',
    firstName: 'Dana',
    lastName: 'Reyes',
    roleId: 'role-technician',
  },
};

jest.mock('../auth/auth-context', () => ({
  useAuth: () => ({
    state: mockState,
    submitting: false,
    signIn: jest.fn(),
    signOut: mockSignOut,
  }),
}));
// The running clock reaches the outbox and the query cache; both have suites of
// their own. Here it only has to be able to say "nothing is running".
let mockClockBadge: string | undefined;
jest.mock('../timeclock/hooks', () => ({ useClockBadge: () => mockClockBadge }));

describe('ProfileScreen', () => {
  beforeEach(() => {
    mockSignOut.mockReset();
    mockClockBadge = undefined;
  });

  it.each(['light', 'dark'] as const)('renders in the %s theme', async (scheme) => {
    await renderScreen(<ProfileScreen />, { scheme });
    expect(screen.getByTestId('profile-screen')).toBeTruthy();
    expect(screen.getByText('Dana Reyes')).toBeTruthy();
    expect(screen.getByText('tech@slk-s.com')).toBeTruthy();
    expect(screen.getByText('role-technician')).toBeTruthy();
  });

  it('signs out on demand', async () => {
    await renderScreen(<ProfileScreen />);
    await fireEvent.press(screen.getByTestId('sign-out'));
    expect(mockSignOut).toHaveBeenCalledTimes(1);
  });

  /**
   * Workiz's Settings menu is App language, Location Tracking, Timesheets, Log
   * out (`WORKIZ_MOBILE_APP.md` §1.12). This app has no language switch, so a
   * technician moving across should find the other three where they were.
   */
  it('keeps Workiz’s own Settings menu: Location Tracking, Timesheet, Log out', async () => {
    await renderScreen(<ProfileScreen onOpenTimesheet={jest.fn()} />);
    expect(screen.getByTestId('location-toggle')).toBeTruthy();
    expect(screen.getByTestId('open-timesheet')).toBeTruthy();
    expect(screen.getByTestId('sign-out')).toBeTruthy();
  });

  it('opens the timesheet from the menu', async () => {
    const onOpenTimesheet = jest.fn();
    await renderScreen(<ProfileScreen onOpenTimesheet={onOpenTimesheet} />);
    await fireEvent.press(screen.getByTestId('open-timesheet'));
    expect(onOpenTimesheet).toHaveBeenCalledTimes(1);
  });

  it('says on the menu itself that the clock is still running', async () => {
    // The technician should not have to open anything to find out.
    mockClockBadge = '7:42';
    await renderScreen(<ProfileScreen onOpenTimesheet={jest.fn()} />);
    expect(screen.getByText('On the clock — 7:42')).toBeTruthy();
  });

  it('offers no location switch it cannot honour: off when nothing can turn it on', async () => {
    // No provider here, so `useLocationSharing` falls back to its dormant
    // value. For a feature that reports where somebody is, the safe direction
    // for a fallback is off — and the row has to say so rather than look on.
    await renderScreen(<ProfileScreen />);
    expect(screen.getByTestId('location-toggle')).not.toBeChecked();
    // The word, not only the state: a switch at arm's length in sunlight is
    // read by its label, and the label is deliberately hidden from the screen
    // reader because the switch itself already announces on or off.
    expect(
      screen.getByTestId('location-toggle-state', { includeHiddenElements: true }),
    ).toHaveTextContent('Off');
  });
});
