import { Text } from 'react-native';
import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import { screen, waitFor } from '@testing-library/react-native';
import { queryKeys } from '../../lib/api/query-keys';
import { createTestQueryClient } from '../../test/query';
import { renderScreen } from '../../test/render';
import { PushProvider } from './push-provider';
import * as device from './device';

jest.mock('./device');

const mockPush = jest.fn();
let mockPathname = '/';

jest.mock('expo-router', () => ({
  router: { push: (...args: unknown[]) => mockPush(...args) },
  usePathname: () => mockPathname,
}));

const mockRemove = jest.fn();
let mockResponseListener: ((r: unknown) => void) | undefined;
let mockArrivalListener: ((n: unknown) => void) | undefined;
let mockLastResponse: unknown = null;
let mockHandler: Notifications.NotificationHandler | null = null;

jest.mock('expo-notifications', () => ({
  setNotificationHandler: jest.fn((h) => {
    mockHandler = h;
  }),
  addNotificationResponseReceivedListener: jest.fn((listener) => {
    mockResponseListener = listener;
    return { remove: mockRemove };
  }),
  addNotificationReceivedListener: jest.fn((listener) => {
    mockArrivalListener = listener;
    return { remove: mockRemove };
  }),
  getLastNotificationResponse: jest.fn(() => mockLastResponse),
  clearLastNotificationResponse: jest.fn(),
}));

const mockDevice = device as jest.Mocked<typeof device>;

/** A tap on a notification carrying `data`. */
const response = (data: unknown, identifier = 'n1') => ({
  notification: { request: { identifier, content: { data } } },
});

/** One arriving while the app is in the foreground. */
const arrival = (data: unknown) => ({ request: { content: { data } } });

let client: QueryClient;

beforeEach(() => {
  mockPush.mockReset();
  mockRemove.mockReset();
  mockPathname = '/';
  mockResponseListener = undefined;
  mockArrivalListener = undefined;
  mockLastResponse = null;
  mockHandler = null;
  client = createTestQueryClient();
  mockDevice.registerPushDevice.mockResolvedValue({ status: 'not-yet' });
  mockDevice.ensureAndroidChannel.mockResolvedValue(undefined);
});

/**
 * The provider under a query client, as it is in the app — `QueryProvider`
 * sits above the router. A component rather than an inline tree so `rerender`
 * puts the client back too.
 */
function Harness() {
  return (
    <QueryClientProvider client={client}>
      <PushProvider>
        <Text>the app</Text>
      </PushProvider>
    </QueryClientProvider>
  );
}

const mount = () => renderScreen(<Harness />);

describe('PushProvider', () => {
  it('renders the app it wraps and nothing of its own', async () => {
    await mount();
    expect(screen.getByText('the app')).toBeTruthy();
  });

  it('offers the phone to the server once, on mount', async () => {
    await mount();
    await waitFor(() => expect(mockDevice.registerPushDevice).toHaveBeenCalledTimes(1));
    expect(mockDevice.ensureAndroidChannel).toHaveBeenCalled();
  });

  it('does not let a registration failure reach the screen', async () => {
    // The whole point: no dev build, no accounts, no crash, no dialog.
    mockDevice.registerPushDevice.mockResolvedValue({
      status: 'unavailable',
      reason: 'no-project-id',
    });
    await mount();

    await waitFor(() => expect(mockDevice.registerPushDevice).toHaveBeenCalled());
    expect(screen.getByText('the app')).toBeTruthy();
  });

  describe('a tap', () => {
    it('opens the job it is about', async () => {
      await mount();
      mockResponseListener?.(response({ kind: 'job', dealId: 'job-7' }));
      expect(mockPush).toHaveBeenCalledWith('/jobs/job-7');
    });

    it('opens the chat for a conversation', async () => {
      await mount();
      mockResponseListener?.(
        response({ kind: 'conversation', conversationId: 'c1', messageId: 'm1' }),
      );
      expect(mockPush).toHaveBeenCalledWith('/chat');
    });

    it('opens the app and stops for a payload it cannot read', async () => {
      await mount();
      mockResponseListener?.(response({ kind: 'invoice', invoiceId: 'i1' }));
      expect(mockPush).not.toHaveBeenCalled();
    });

    it('opens the job the app was launched by', async () => {
      // Cold start: the tap *is* the launch, so the event is long gone by the
      // time anything mounts and has to be read back instead.
      mockLastResponse = response({ kind: 'job', dealId: 'job-9' });
      await mount();

      expect(mockPush).toHaveBeenCalledWith('/jobs/job-9');
      // And is cleared, so the next launch is not a phantom tap.
      expect(Notifications.clearLastNotificationResponse).toHaveBeenCalled();
    });

    it('opens one screen when both sources describe the same tap', async () => {
      mockLastResponse = response({ kind: 'job', dealId: 'job-9' }, 'same');
      await mount();
      mockResponseListener?.(response({ kind: 'job', dealId: 'job-9' }, 'same'));

      // Two screens would leave a technician pressing Back twice.
      expect(mockPush).toHaveBeenCalledTimes(1);
    });

    it('still opens a second, different notification', async () => {
      await mount();
      mockResponseListener?.(response({ kind: 'job', dealId: 'job-1' }, 'n1'));
      mockResponseListener?.(response({ kind: 'job', dealId: 'job-2' }, 'n2'));
      expect(mockPush).toHaveBeenCalledTimes(2);
    });
  });

  describe('one arriving while the technician is holding the phone', () => {
    it('shows a quiet banner and never takes the screen', async () => {
      await mount();

      await expect(
        mockHandler!.handleNotification({
          request: { content: { data: { kind: 'job', dealId: 'd1' } } },
        } as never),
      ).resolves.toEqual({
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: false,
        shouldSetBadge: false,
      });
      // Arriving is not tapping: nothing moved.
      expect(mockPush).not.toHaveBeenCalled();
    });

    it('says nothing about the screen already open', async () => {
      mockPathname = '/jobs/d1';
      await mount();

      await expect(
        mockHandler!.handleNotification({
          request: { content: { data: { kind: 'job', dealId: 'd1' } } },
        } as never),
      ).resolves.toMatchObject({ shouldShowBanner: false });
    });

    it('makes the job it is about reload, so the card stops showing the old time', async () => {
      /*
       * The point of the quiet cases. Dispatch moves the 2 o'clock to 4 and
       * the phone is open on the day list: a banner over a card that still
       * says 2 o'clock is worse than none, and on the job's own screen no
       * banner goes up at all — so without this the technician is told
       * nothing and shown the old time.
       */
      const seen: unknown[][] = [];
      client.invalidateQueries = jest.fn((filters?: { queryKey?: unknown[] }) => {
        seen.push(filters?.queryKey ?? []);
        return Promise.resolve();
      }) as unknown as typeof client.invalidateQueries;

      await mount();
      mockArrivalListener?.(arrival({ kind: 'job', dealId: 'd1' }));

      expect(seen).toEqual([queryKeys.deals.lists(), queryKeys.deals.detail('d1')]);
      // Arriving still never moves the technician anywhere.
      expect(mockPush).not.toHaveBeenCalled();
    });

    it('reloads nothing for a payload it cannot read', async () => {
      const invalidate = jest.fn(() => Promise.resolve());
      client.invalidateQueries = invalidate as unknown as typeof client.invalidateQueries;

      await mount();
      mockArrivalListener?.(arrival({ kind: 'invoice', invoiceId: 'i1' }));

      expect(invalidate).not.toHaveBeenCalled();
    });

    it('follows the technician as they move between screens', async () => {
      // The handler is registered once and outlives any one screen, so it has
      // to read where they are now, not where they were when it was set up.
      mockPathname = '/';
      const view = await mount();

      mockPathname = '/chat';
      await view.rerender(<Harness />);

      await expect(
        mockHandler!.handleNotification({
          request: {
            content: { data: { kind: 'conversation', conversationId: 'c1', messageId: 'm1' } },
          },
        } as never),
      ).resolves.toMatchObject({ shouldShowBanner: false });
    });
  });
});
