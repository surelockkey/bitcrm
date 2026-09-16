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

describe('ProfileScreen', () => {
  beforeEach(() => mockSignOut.mockReset());

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
});
