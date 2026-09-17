import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { QueryClientProvider } from '@tanstack/react-query';
import { ApiError } from '../../lib/api/errors';
import type { QueueRecord } from '../../lib/queue/types';
import { createTestQueryClient } from '../../test/query';
import { renderScreen } from '../../test/render';
import type { FeedMessage } from './api';
import { ChatScreen } from './chat-screen';

const mockSend = jest.fn().mockResolvedValue(undefined);
const mockRetry = jest.fn();
const mockFetchNextPage = jest.fn();
const mockRefetch = jest.fn();

let mockRecords: QueueRecord[] = [];
let mockThread: { data?: unknown; isLoading: boolean; error: unknown };
let mockFeed: {
  data?: { pages: { data: FeedMessage[] }[] };
  isLoading: boolean;
  error: unknown;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
};

jest.mock('../jobs/hooks', () => ({ useMe: () => ({ data: { id: 'tech-1' } }) }));
jest.mock('../queue/queue-provider', () => ({
  useQueue: () => ({ records: mockRecords, retry: mockRetry }),
}));
jest.mock('./hooks', () => ({
  useOfficeThread: () => ({ ...mockThread, refetch: mockRefetch }),
  useThreadFeed: () => ({
    ...mockFeed,
    refetch: mockRefetch,
    fetchNextPage: mockFetchNextPage,
  }),
  useMarkThreadRead: jest.fn(),
  useSendToOffice: () => ({ send: mockSend }),
}));

/** Today, at a fixed hour: the day chip is relative, so the fixture has to be too. */
const todayAt = (hour: number, minute = 0) => {
  const d = new Date();
  d.setHours(hour, minute, 0, 0);
  return d.toISOString();
};

const message = (over: Partial<FeedMessage> = {}): FeedMessage => ({
  id: 'm1',
  conversationId: 'conv-1',
  channel: 'in_app',
  direction: 'outbound',
  status: 'sent',
  origin: 'user',
  sentByUserId: 'office-9',
  sentByName: 'Dana',
  body: 'Gate code is 4021',
  createdAt: todayAt(12, 10),
  updatedAt: todayAt(12, 10),
  ...over,
});

const queued = (over: Partial<QueueRecord & { queue: 'outbox' }> = {}): QueueRecord =>
  ({
    queue: 'outbox',
    id: 'q1',
    userId: 'tech-1',
    kind: 'chat',
    dealId: '',
    payload: JSON.stringify({ conversationId: 'conv-1', body: 'On my way back' }),
    createdAt: new Date(todayAt(13, 0)).getTime(),
    attempts: 0,
    nextAttemptAt: 0,
    lastError: null,
    state: 'pending',
    ...over,
  }) as QueueRecord;

const render = (props: Partial<React.ComponentProps<typeof ChatScreen>> = {}) =>
  renderScreen(
    <QueryClientProvider client={createTestQueryClient()}>
      <ChatScreen {...props} />
    </QueryClientProvider>,
  );

describe('ChatScreen', () => {
  beforeEach(() => {
    mockRecords = [];
    mockThread = { data: { id: 'conv-1' }, isLoading: false, error: null };
    mockFeed = {
      data: { pages: [{ data: [message()] }] },
      isLoading: false,
      error: null,
      hasNextPage: false,
      isFetchingNextPage: false,
    };
    mockSend.mockClear();
    mockRetry.mockReset();
    mockFetchNextPage.mockReset();
    mockRefetch.mockReset();
  });

  it.each(['light', 'dark'] as const)('renders the thread in the %s theme', async (scheme) => {
    await renderScreen(
      <QueryClientProvider client={createTestQueryClient()}>
        <ChatScreen />
      </QueryClientProvider>,
      { scheme },
    );
    expect(screen.getByTestId('chat-screen')).toBeTruthy();
    expect(screen.getByText('Gate code is 4021')).toBeTruthy();
    expect(screen.getByText('Dana')).toBeTruthy();
    expect(screen.getByText('Today')).toBeTruthy();
  });

  it('queues what the technician writes and empties the box', async () => {
    await render();

    await fireEvent.changeText(screen.getByTestId('chat-input'), 'door is locked');
    await fireEvent.press(screen.getByTestId('chat-send'));

    await waitFor(() => expect(mockSend).toHaveBeenCalledWith('door is locked'));
    expect(screen.getByTestId('chat-input').props.value).toBe('');
  });

  it('will not send an empty box', async () => {
    await render();
    await fireEvent.press(screen.getByTestId('chat-send'));
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('shows a queued line as waiting, on the technician’s own side', async () => {
    mockRecords = [queued()];
    await render();

    expect(screen.getByText('On my way back')).toBeTruthy();
    expect(screen.getByText('Waiting for a signal')).toBeTruthy();
    expect(screen.queryByTestId('message-retry-q1')).toBeNull();
  });

  it('offers a retry, with the reason, on a line that could not be sent', async () => {
    mockRecords = [queued({ state: 'failed', lastError: 'Request failed' })];
    await render();

    expect(screen.getByText('Not sent · Request failed')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('message-retry-q1'));
    expect(mockRetry).toHaveBeenCalledWith('outbox', 'q1');
  });

  it('still takes a message with no signal and nothing downloaded', async () => {
    // The whole offline path: the thread never loaded, the feed never loaded,
    // and the composer still works because sending is a queue insert.
    mockThread = { data: undefined, isLoading: false, error: new ApiError(0, 'offline') };
    mockFeed = { ...mockFeed, data: undefined, error: null };

    await render();

    expect(screen.getByTestId('chat-error')).toBeTruthy();
    expect(screen.getByText('No signal')).toBeTruthy();

    await fireEvent.changeText(screen.getByTestId('chat-input'), 'in the basement');
    await fireEvent.press(screen.getByTestId('chat-send'));
    await waitFor(() => expect(mockSend).toHaveBeenCalledWith('in the basement'));
  });

  it('offers a way out of a failure rather than a spinner', async () => {
    mockThread = { data: undefined, isLoading: false, error: new ApiError(500, 'Upstream is down') };
    mockFeed = { ...mockFeed, data: undefined };
    await render();

    expect(screen.getByText('Upstream is down')).toBeTruthy();
    await fireEvent.press(screen.getByText('Try again'));
    expect(mockRefetch).toHaveBeenCalled();
  });

  it('says the thread is empty rather than spinning when there is nothing in it', async () => {
    mockThread = { data: undefined, isLoading: false, error: null };
    mockFeed = { ...mockFeed, data: undefined };
    await render();

    expect(screen.getByTestId('chat-empty')).toBeTruthy();
    expect(screen.getByTestId('chat-input')).toBeTruthy();
  });

  it('shows the spinner only while something is genuinely on its way', async () => {
    mockThread = { data: undefined, isLoading: true, error: null };
    mockFeed = { ...mockFeed, data: undefined, isLoading: false };
    await render();
    expect(screen.getByTestId('splash')).toBeTruthy();
  });

  it('loads older messages on demand', async () => {
    mockFeed = { ...mockFeed, hasNextPage: true };
    await render();

    await fireEvent.press(screen.getByTestId('chat-load-older'));
    expect(mockFetchNextPage).toHaveBeenCalled();
  });

  it('keeps what the phone already has when the server cannot be reached', async () => {
    mockFeed = { ...mockFeed, error: new ApiError(0, 'offline') };
    await render();

    expect(screen.getByText('Gate code is 4021')).toBeTruthy();
    expect(
      screen.getByText(/could not reach the\s+server just now/),
    ).toBeTruthy();
  });

  it('comes with a way back when it was opened from a job', async () => {
    const onBack = jest.fn();
    await render({ onBack, dealId: 'deal-7' });

    expect(screen.getByText('Goes to the office, linked to the job you came from.')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('chat-back'));
    expect(onBack).toHaveBeenCalled();
  });
});
