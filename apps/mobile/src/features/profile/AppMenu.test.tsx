import { Alert } from 'react-native';
import { fireEvent, screen } from '@testing-library/react-native';
import { renderScreen } from '../../test/render';
import { DrawerHost, MenuButton } from '../../ui/Drawer';
import { AppMenu } from './AppMenu';
import type { AuthState } from '../auth/auth-reducer';
import type { OutboxRecord, QueueRecord } from '../../lib/queue/types';

const mockSignOut = jest.fn();
let mockState: AuthState;
jest.mock('../auth/auth-context', () => ({
  useAuth: () => ({
    state: mockState,
    submitting: false,
    signIn: jest.fn(),
    signOut: mockSignOut,
  }),
}));

let mockRecords: QueueRecord[] = [];
jest.mock('../queue/queue-provider', () => ({
  useQueue: () => ({ records: mockRecords }),
}));

let mockClock: string | undefined;
jest.mock('../timeclock/hooks', () => ({ useClockBadge: () => mockClock }));

const queued = (over: Partial<OutboxRecord> = {}): QueueRecord => ({
  queue: 'outbox',
  id: 'q1',
  userId: 'tech-1',
  kind: 'arrived',
  dealId: 'd1',
  payload: '{}',
  createdAt: 0,
  attempts: 0,
  nextAttemptAt: 0,
  lastError: null,
  state: 'pending',
  ...over,
});

async function renderMenu(onNavigate = jest.fn(), scheme?: 'light' | 'dark') {
  await renderScreen(
    <DrawerHost menu={<AppMenu onNavigate={onNavigate} />}>
      <MenuButton />
    </DrawerHost>,
    scheme ? { scheme } : undefined,
  );
  await fireEvent.press(screen.getByTestId('open-menu'));
  return onNavigate;
}

describe('AppMenu', () => {
  beforeEach(() => {
    mockSignOut.mockReset();
    mockRecords = [];
    mockClock = undefined;
    mockState = {
      status: 'signedIn',
      user: {
        id: 'u-1',
        email: 'tech@slk-s.com',
        firstName: 'Dana',
        lastName: 'Reyes',
        department: 'Sure Lock & Key',
      },
    };
  });

  it.each(['light', 'dark'] as const)('renders in the %s theme', async (scheme) => {
    await renderMenu(jest.fn(), scheme);
    expect(screen.getByTestId('app-menu')).toBeTruthy();
  });

  /** Workiz heads the menu with the name large and the account under it (§2). */
  it('leads with who is signed in and to what', async () => {
    await renderMenu();
    expect(screen.getByText('Dana Reyes')).toBeTruthy();
    expect(screen.getByText('Sure Lock & Key')).toBeTruthy();
  });

  it('lists the rows in Workiz’s order', async () => {
    await renderMenu();
    for (const key of ['timesheets', 'jobs', 'stock', 'queue', 'settings', 'profile', 'logout']) {
      expect(screen.getByTestId(`menu-${key}`)).toBeTruthy();
    }
  });

  it.each([
    ['timesheets', '/timesheet'],
    ['jobs', '/jobs'],
    ['stock', '/stock'],
    ['queue', '/queue'],
    ['settings', '/settings'],
    ['profile', '/profile'],
  ])('opens %s at %s', async (key, href) => {
    const onNavigate = await renderMenu();
    await fireEvent.press(screen.getByTestId(`menu-${key}`));
    expect(onNavigate).toHaveBeenCalledWith(href);
  });

  /**
   * A menu left open over the screen it just opened is the commonest way a
   * phone menu feels broken — and this one is a full-screen modal.
   */
  it('closes itself on the way to the screen it opened', async () => {
    await renderMenu();
    await fireEvent.press(screen.getByTestId('menu-jobs'));
    expect(screen.queryByTestId('app-menu')).toBeNull();
  });

  it('says on the row itself that the clock is still running', async () => {
    mockClock = '1:24';
    await renderMenu();
    expect(screen.getByTestId('menu-timesheets-badge')).toHaveTextContent('1:24');
  });

  it('counts what this phone has not managed to send', async () => {
    mockRecords = [queued({ id: 'a' }), queued({ id: 'b', state: 'failed' })];
    await renderMenu();
    expect(screen.getByTestId('menu-queue-badge')).toHaveTextContent('2');
  });

  it('badges nothing when there is nothing waiting', async () => {
    await renderMenu();
    expect(screen.queryByTestId('menu-queue-badge')).toBeNull();
  });

  /**
   * The one row with no way back from a mis-tap, sitting in a list of rows
   * that all open a screen. It asks first.
   */
  it('asks before ending the session, and only signs out on yes', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    await renderMenu();
    await fireEvent.press(screen.getByTestId('menu-logout'));

    expect(mockSignOut).not.toHaveBeenCalled();
    const buttons = alert.mock.calls[0][2]!;
    expect(buttons.map((b) => b.text)).toEqual(['Stay signed in', 'Log out']);

    buttons[1].onPress?.();
    expect(mockSignOut).toHaveBeenCalledTimes(1);
    alert.mockRestore();
  });

  it('draws a header even before the profile has a name in it', async () => {
    mockState = { status: 'signedOut' } as AuthState;
    await renderMenu();
    expect(screen.getByTestId('app-menu-account')).toBeTruthy();
  });
});
