import { fireEvent, screen } from '@testing-library/react-native';
import { renderScreen } from '../../test/render';
import { LoginScreen } from './login-screen';
import type { AuthState } from './auth-reducer';

const mockSignIn = jest.fn();
let mockState: AuthState = { status: 'signedOut' };
let mockSubmitting = false;

jest.mock('./auth-context', () => ({
  useAuth: () => ({
    state: mockState,
    submitting: mockSubmitting,
    signIn: mockSignIn,
    signOut: jest.fn(),
  }),
}));

describe('LoginScreen', () => {
  beforeEach(() => {
    mockState = { status: 'signedOut' };
    mockSubmitting = false;
    mockSignIn.mockReset();
  });

  it.each(['light', 'dark'] as const)('renders in the %s theme', async (scheme) => {
    await renderScreen(<LoginScreen />, { scheme });
    expect(screen.getByTestId('login-screen')).toBeTruthy();
    expect(screen.getByLabelText('Email')).toBeTruthy();
    expect(screen.getByLabelText('Password')).toBeTruthy();
  });

  it('keeps the button inert until both fields are filled in', async () => {
    await renderScreen(<LoginScreen />);
    await fireEvent.press(screen.getByTestId('sign-in'));
    expect(mockSignIn).not.toHaveBeenCalled();

    await fireEvent.changeText(screen.getByLabelText('Email'), 'tech@slk-s.com');
    await fireEvent.press(screen.getByTestId('sign-in'));
    expect(mockSignIn).not.toHaveBeenCalled();

    await fireEvent.changeText(screen.getByLabelText('Password'), 'hunter2');
    await fireEvent.press(screen.getByTestId('sign-in'));
    expect(mockSignIn).toHaveBeenCalledWith('tech@slk-s.com', 'hunter2');
  });

  it('shows the reason a sign-in was refused', async () => {
    mockState = { status: 'signedOut', error: 'Incorrect username or password.' };
    await renderScreen(<LoginScreen />);
    expect(screen.getByText('Incorrect username or password.')).toBeTruthy();
  });

  it('does not fire a second sign-in while one is in flight', async () => {
    mockSubmitting = true;
    await renderScreen(<LoginScreen />);
    await fireEvent.changeText(screen.getByLabelText('Email'), 'tech@slk-s.com');
    await fireEvent.changeText(screen.getByLabelText('Password'), 'hunter2');
    await fireEvent.press(screen.getByTestId('sign-in'));
    expect(mockSignIn).not.toHaveBeenCalled();
  });
});
