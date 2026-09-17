import { fireEvent, screen } from '@testing-library/react-native';
import { ApiError } from '../../lib/api/errors';
import type { QueueRecord } from '../../lib/queue/types';
import { renderScreen } from '../../test/render';
import { JobSuperStatus, type Deal } from '../jobs/types';
import type { ClientTextLookup, ClientThread, FeedMessage } from './api';
import { ClientThreadScreen } from './client-thread-screen';

const mockSend = jest.fn().mockResolvedValue(undefined);
const mockRetry = jest.fn();
const mockRefetch = jest.fn();
const mockFetchNextPage = jest.fn();

let mockRecords: QueueRecord[] = [];
let mockDeal: Deal | undefined;
let mockThread: { data?: ClientThread | null; isLoading: boolean; error: unknown };
let mockLookup: { data?: ClientTextLookup };
let mockFeed: {
  data?: { pages: { data: FeedMessage[] }[] };
  isLoading: boolean;
  error: unknown;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
};
/** What `useSendToClient` was asked for — the job and the client on it. */
let mockSendArgs: [string, string | undefined] | null = null;

jest.mock('../jobs/hooks', () => ({
  useMe: () => ({ data: { id: 'tech-1' } }),
  useJob: () => ({ data: mockDeal, isPending: mockDeal === undefined }),
}));
jest.mock('../queue/queue-provider', () => ({
  useQueue: () => ({ records: mockRecords, retry: mockRetry }),
}));
jest.mock('./hooks', () => ({
  useJobClientThread: () => ({ ...mockThread, refetch: mockRefetch }),
  useClientTextLookup: () => mockLookup,
  useThreadFeed: () => ({
    ...mockFeed,
    refetch: mockRefetch,
    fetchNextPage: mockFetchNextPage,
  }),
  useSendToClient: (dealId: string, contactId: string | undefined) => {
    mockSendArgs = [dealId, contactId];
    return { send: mockSend, canSend: Boolean(contactId) };
  },
}));

const todayAt = (hour: number, minute = 0) => {
  const d = new Date();
  d.setHours(hour, minute, 0, 0);
  return d.toISOString();
};

const deal = (over: Partial<Deal> = {}): Deal => ({
  id: 'deal-1',
  dealNumber: 'K4T9ZW',
  contactId: 'contact-9',
  address: { street: '1 Main St', city: 'Hartford', state: 'CT', zip: '06103' },
  superStatus: JobSuperStatus.IN_PROGRESS,
  clientName: { firstName: 'Ada', lastName: 'Byron' },
  ...over,
});

const thread = (over: Partial<ClientThread> = {}): ClientThread => ({
  id: 'conv-client',
  kind: 'client',
  partyKind: 'contact',
  partyId: 'contact-9',
  addresses: { phones: ['+18605550101'], emails: [] },
  state: 'open',
  unread: false,
  unreadCount: 0,
  flagged: false,
  createdAt: todayAt(8),
  updatedAt: todayAt(12),
  ...over,
});

const message = (over: Partial<FeedMessage> = {}): FeedMessage => ({
  id: 'm1',
  conversationId: 'conv-client',
  channel: 'sms',
  direction: 'outbound',
  status: 'sent',
  origin: 'user',
  sentByUserId: 'office-9',
  sentByName: 'Dana',
  body: 'Your technician is on the way',
  createdAt: todayAt(12, 10),
  updatedAt: todayAt(12, 10),
  ...over,
});

const smsRow = (over: Partial<QueueRecord & { queue: 'outbox' }> = {}): QueueRecord =>
  ({
    queue: 'outbox',
    id: 'q1',
    userId: 'tech-1',
    kind: 'client_sms',
    dealId: 'deal-1',
    payload: JSON.stringify({ contactId: 'contact-9', body: 'I am outside' }),
    createdAt: Date.now(),
    attempts: 0,
    nextAttemptAt: 0,
    lastError: null,
    state: 'pending',
    ...over,
  }) as QueueRecord;

const render = (props: Partial<React.ComponentProps<typeof ClientThreadScreen>> = {}) =>
  renderScreen(
    <ClientThreadScreen dealId="deal-1" onBack={jest.fn()} {...props} />,
    props.live === undefined ? {} : {},
  );

beforeEach(() => {
  mockSend.mockClear();
  mockRetry.mockClear();
  mockRefetch.mockClear();
  mockFetchNextPage.mockClear();
  mockRecords = [];
  mockSendArgs = null;
  mockDeal = deal();
  mockThread = { data: thread(), isLoading: false, error: null };
  mockLookup = { data: { conversation: thread(), optOut: null, canText: true } };
  mockFeed = {
    data: { pages: [{ data: [message()] }] },
    isLoading: false,
    error: null,
    hasNextPage: false,
    isFetchingNextPage: false,
  };
});

describe('ClientThreadScreen', () => {
  it.each(['light', 'dark'] as const)('draws the client’s thread in the %s theme', async (scheme) => {
    await renderScreen(<ClientThreadScreen dealId="deal-1" onBack={jest.fn()} />, { scheme });

    expect(screen.getByTestId('client-thread-screen')).toBeTruthy();
    expect(screen.getByTestId('client-feed')).toBeTruthy();
    expect(screen.getByText('Your technician is on the way')).toBeTruthy();
  });

  /* ----------------------------------------------------------------------
   * Which thread am I in — the one mistake this screen must make impossible.
   * -------------------------------------------------------------------- */

  it('names the client in the header, the strip, the box and the hint', async () => {
    await render();

    expect(screen.getByText('Ada Byron')).toBeTruthy();
    expect(screen.getByText('Client · text message')).toBeTruthy();
    expect(screen.getByTestId('audience-client')).toBeTruthy();
    expect(screen.getByText(/The office is not on this thread/)).toBeTruthy();
    expect(screen.getByPlaceholderText('Text Ada Byron')).toBeTruthy();
    expect(screen.getByLabelText('Text message to Ada Byron')).toBeTruthy();
    expect(screen.getByText(/Goes to the client as a text/)).toBeTruthy();
  });

  it('carries none of the office thread’s wording', async () => {
    await render();

    expect(screen.queryByText('Office')).toBeNull();
    expect(screen.queryByPlaceholderText('Write to the office')).toBeNull();
    expect(screen.queryByTestId('audience-office')).toBeNull();
    expect(screen.queryByTestId('chat-input')).toBeNull();
  });

  it('draws only the texts queued for this client, never the office’s', async () => {
    mockRecords = [
      smsRow({ id: 'to-client' }),
      {
        ...smsRow({ id: 'to-office' }),
        kind: 'chat',
        payload: JSON.stringify({ body: 'Dispatch, the gate is locked' }),
      } as QueueRecord,
    ];
    await render();

    expect(screen.getByText('I am outside')).toBeTruthy();
    expect(screen.queryByText('Dispatch, the gate is locked')).toBeNull();
  });

  /* ------------------------------------------------------------- sending */

  it('queues what was typed, against this job and this client', async () => {
    await render();

    await fireEvent.changeText(screen.getByTestId('client-input'), 'I am outside');
    await fireEvent.press(screen.getByTestId('client-send'));

    expect(mockSend).toHaveBeenCalledWith('I am outside');
    expect(mockSendArgs).toEqual(['deal-1', 'contact-9']);
  });

  it('keeps Send inert until something has been typed', async () => {
    await render();
    expect(
      screen.getByTestId('client-send').props.accessibilityState.disabled,
    ).toBe(true);
  });

  it('shows a queued text as waiting, and offers a retry on one that failed', async () => {
    mockRecords = [smsRow({ state: 'failed', lastError: 'Carrier rejected it' })];
    await render();

    expect(screen.getByText('Not sent · Carrier rejected it')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('message-retry-q1'));
    expect(mockRetry).toHaveBeenCalledWith('outbox', 'q1');
  });

  it('blocks the box for a client who replied STOP, and says why', async () => {
    mockLookup = {
      data: {
        conversation: thread(),
        optOut: {
          channel: 'sms',
          address: '+18605550101',
          status: 'opted_out',
          source: 'advanced_opt_out',
          history: [],
          updatedAt: todayAt(9),
        },
        canText: false,
      },
    };
    await render();

    expect(screen.getByTestId('client-opted-out')).toBeTruthy();
    expect(screen.getByText(/replied STOP/)).toBeTruthy();
    expect(
      screen.getByTestId('client-send').props.accessibilityState.disabled,
    ).toBe(true);
  });

  // The lookup needs a signal; the outbox does not. A call that failed says
  // nothing either way, and must not be read as "do not write".
  it('lets the technician write when the lookup never answered', async () => {
    mockLookup = { data: undefined };
    await render();

    await fireEvent.changeText(screen.getByTestId('client-input'), 'I am outside');
    await fireEvent.press(screen.getByTestId('client-send'));
    expect(mockSend).toHaveBeenCalled();
  });

  it('says plainly when a job has no client to text', async () => {
    mockDeal = deal({ contactId: '' });
    await render();

    expect(screen.getByTestId('client-no-contact')).toBeTruthy();
    expect(
      screen.getByTestId('client-send').props.accessibilityState.disabled,
    ).toBe(true);
  });

  // "No client on this job" and "the job has not reached this phone yet" are
  // different sentences, and the wrong one sends a technician to ring the
  // office about a job that is simply still downloading.
  it('does not call a job it has not downloaded a job without a client', async () => {
    mockDeal = undefined;
    await render();

    expect(screen.getByTestId('client-job-loading')).toBeTruthy();
    expect(screen.queryByTestId('client-no-contact')).toBeNull();
  });

  /* ------------------------------------------------------------- reading */

  it('offers the first line rather than an error when nobody has texted yet', async () => {
    mockThread = { data: null, isLoading: false, error: null };
    mockFeed = { ...mockFeed, data: { pages: [{ data: [] }] } };
    await render();

    expect(screen.getByTestId('client-empty')).toBeTruthy();
    expect(screen.getByText(/never from yours/)).toBeTruthy();
    // And the box is still open: the first text opens the thread.
    expect(screen.getByTestId('client-input')).toBeTruthy();
  });

  it('explains a 403 as the job, not as a role', async () => {
    mockThread = { data: undefined, isLoading: false, error: new ApiError(403, 'no') };
    mockFeed = { ...mockFeed, data: { pages: [{ data: [] }] } };
    await render();

    expect(screen.getByTestId('client-error')).toBeTruthy();
    expect(screen.getByText(/a job you are not on/)).toBeTruthy();
  });

  it('keeps what the phone already has when the refresh fails', async () => {
    mockThread = { data: thread(), isLoading: false, error: new ApiError(0, 'offline') };
    await render();

    expect(screen.getByTestId('client-feed')).toBeTruthy();
    expect(screen.getByText(/could not reach the server just now/)).toBeTruthy();
  });

  it('opens another job a line names, and never this one', async () => {
    const onOpenJob = jest.fn();
    mockFeed = {
      ...mockFeed,
      data: {
        pages: [
          {
            data: [
              message({ id: 'other', dealId: 'deal-2' }),
              message({ id: 'this', dealId: 'deal-1', createdAt: todayAt(11) }),
            ],
          },
        ],
      },
    };
    await render({ onOpenJob });

    expect(screen.queryByTestId('message-job-this')).toBeNull();
    await fireEvent.press(screen.getByTestId('message-job-other'));
    expect(onOpenJob).toHaveBeenCalledWith('deal-2');
  });

  it('comes with a way back to the job', async () => {
    const onBack = jest.fn();
    await render({ onBack });

    await fireEvent.press(screen.getByTestId('client-back'));
    expect(onBack).toHaveBeenCalled();
  });
});
