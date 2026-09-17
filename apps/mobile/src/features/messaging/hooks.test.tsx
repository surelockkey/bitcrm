import { renderHook, waitFor } from '@testing-library/react-native';
import { createTestQueryClient, withQuery } from '../../test/query';
import * as api from './api';
import type { FeedMessage, TeamThread } from './api';
import {
  useJobClientThread,
  useMarkThreadRead,
  useOfficeThread,
  useSendToClient,
  useSendToOffice,
  useThreadFeed,
} from './hooks';

jest.mock('./api');

const mockEnqueueAction = jest.fn().mockResolvedValue('q1');
jest.mock('../queue/queue-provider', () => ({
  useQueue: () => ({ enqueueAction: mockEnqueueAction }),
}));

const mockApi = api as jest.Mocked<typeof api>;

const thread = (over: Partial<TeamThread> = {}): TeamThread => ({
  id: 'conv-1',
  kind: 'team',
  partyKind: 'user',
  partyId: 'tech-1',
  addresses: { phones: [], emails: [] },
  state: 'open',
  unread: false,
  unreadCount: 0,
  flagged: false,
  viewerUnread: false,
  viewerUnreadCount: 0,
  createdAt: '2026-09-01T09:00:00.000Z',
  updatedAt: '2026-09-16T09:00:00.000Z',
  ...over,
});

const message = (over: Partial<FeedMessage> = {}): FeedMessage => ({
  id: 'm1',
  conversationId: 'conv-1',
  channel: 'in_app',
  direction: 'outbound',
  status: 'sent',
  origin: 'user',
  body: 'Gate code is 4021',
  createdAt: '2026-09-16T12:10:00.000Z',
  updatedAt: '2026-09-16T12:10:00.000Z',
  ...over,
});

const page = <T,>(data: T[], nextCursor?: string) => ({
  data,
  pagination: { nextCursor, count: data.length },
});

describe('useOfficeThread', () => {
  beforeEach(() => mockApi.listTeamThreads.mockReset());

  it('asks for the staff threads and hands back the technician’s own', async () => {
    mockApi.listTeamThreads.mockResolvedValue(
      page([thread({ id: 'theirs', partyId: 'tech-2' }), thread({ id: 'mine' })]),
    );
    const { result } = await renderHook(() => useOfficeThread('tech-1'), {
      wrapper: withQuery(createTestQueryClient()),
    });

    await waitFor(() => expect(result.current.data?.id).toBe('mine'));
  });

  it('asks for nothing until the phone knows who is signed in', async () => {
    mockApi.listTeamThreads.mockResolvedValue(page([]));
    const { result } = await renderHook(() => useOfficeThread(undefined), {
      wrapper: withQuery(createTestQueryClient()),
    });

    expect(mockApi.listTeamThreads).not.toHaveBeenCalled();
    // Not "loading": there is nothing to wait for, and a spinner would never end.
    expect(result.current.isLoading).toBe(false);
  });
});

describe('useThreadFeed', () => {
  beforeEach(() => mockApi.listMessages.mockReset());

  it('reads the newest page first and can load older behind it', async () => {
    mockApi.listMessages.mockResolvedValue(page([message()], 'cursor-2'));
    const { result } = await renderHook(() => useThreadFeed('conv-1', true), {
      wrapper: withQuery(createTestQueryClient()),
    });

    await waitFor(() => expect(result.current.data?.pages.length).toBe(1));
    expect(mockApi.listMessages).toHaveBeenCalledWith('conv-1', undefined, 30);
    expect(result.current.hasNextPage).toBe(true);

    await result.current.fetchNextPage();
    await waitFor(() =>
      expect(mockApi.listMessages).toHaveBeenLastCalledWith('conv-1', 'cursor-2', 30),
    );
  });

  it('reads nothing at all until there is a thread to read', async () => {
    mockApi.listMessages.mockResolvedValue(page([]));
    await renderHook(() => useThreadFeed(undefined, true), {
      wrapper: withQuery(createTestQueryClient()),
    });
    expect(mockApi.listMessages).not.toHaveBeenCalled();
  });
});

describe('useMarkThreadRead', () => {
  beforeEach(() => mockApi.markThreadRead.mockReset());

  it('marks the thread read up to the newest line on screen', async () => {
    mockApi.markThreadRead.mockResolvedValue({});
    await renderHook(() => useMarkThreadRead('conv-1', 'MSG#2026-09-16#m1', true), {
      wrapper: withQuery(createTestQueryClient()),
    });

    await waitFor(() =>
      expect(mockApi.markThreadRead).toHaveBeenCalledWith('conv-1', 'MSG#2026-09-16#m1'),
    );
  });

  it('says nothing while the screen is not being looked at', async () => {
    mockApi.markThreadRead.mockResolvedValue({});
    await renderHook(() => useMarkThreadRead('conv-1', 'MSG#1', false), {
      wrapper: withQuery(createTestQueryClient()),
    });
    expect(mockApi.markThreadRead).not.toHaveBeenCalled();
  });

  it('does not re-post the same marker on every poll', async () => {
    mockApi.markThreadRead.mockResolvedValue({});
    const { rerender } = await renderHook(
      ({ sk }: { sk: string }) => useMarkThreadRead('conv-1', sk, true),
      { wrapper: withQuery(createTestQueryClient()), initialProps: { sk: 'MSG#1' } },
    );

    await waitFor(() => expect(mockApi.markThreadRead).toHaveBeenCalledTimes(1));
    await rerender({ sk: 'MSG#1' });
    expect(mockApi.markThreadRead).toHaveBeenCalledTimes(1);

    await rerender({ sk: 'MSG#2' });
    await waitFor(() => expect(mockApi.markThreadRead).toHaveBeenCalledTimes(2));
  });
});

describe('useSendToOffice', () => {
  beforeEach(() => mockEnqueueAction.mockClear());

  it('queues the line rather than sending it, so a basement is not a lost message', async () => {
    const { result } = await renderHook(() => useSendToOffice('conv-1'), {
      wrapper: withQuery(createTestQueryClient()),
    });

    await result.current.send('  running 20 min late  ');

    expect(mockEnqueueAction).toHaveBeenCalledWith({
      kind: 'chat',
      dealId: '',
      payload: { conversationId: 'conv-1', body: 'running 20 min late' },
    });
  });

  it('carries the job when the technician opened the chat from one', async () => {
    const { result } = await renderHook(() => useSendToOffice('conv-1', 'deal-7'), {
      wrapper: withQuery(createTestQueryClient()),
    });

    await result.current.send('door is locked');
    expect(mockEnqueueAction).toHaveBeenCalledWith({
      kind: 'chat',
      dealId: 'deal-7',
      payload: { conversationId: 'conv-1', body: 'door is locked' },
    });
  });

  it('queues nothing for an empty box', async () => {
    const { result } = await renderHook(() => useSendToOffice('conv-1'), {
      wrapper: withQuery(createTestQueryClient()),
    });

    await result.current.send('   ');
    expect(mockEnqueueAction).not.toHaveBeenCalled();
  });

  it('queues a first line with no thread id — the send resolves the thread', async () => {
    const { result } = await renderHook(() => useSendToOffice(undefined), {
      wrapper: withQuery(createTestQueryClient()),
    });

    await result.current.send('hello');
    expect(mockEnqueueAction).toHaveBeenCalledWith({
      kind: 'chat',
      dealId: '',
      payload: { conversationId: undefined, body: 'hello' },
    });
  });
});

describe('useJobClientThread', () => {
  it('asks for the thread of the job, not of a contact it guessed at', async () => {
    mockApi.getJobClientThread.mockResolvedValue(null);
    const { result } = await renderHook(() => useJobClientThread('deal-7'), {
      wrapper: withQuery(createTestQueryClient()),
    });

    await waitFor(() => expect(mockApi.getJobClientThread).toHaveBeenCalledWith('deal-7'));
    // Nothing there yet is an answer, not a failure: the screen offers the
    // first line instead of apologising.
    await waitFor(() => expect(result.current.data).toBeNull());
    expect(result.current.error).toBeNull();
  });

  it('asks for nothing until there is a job', async () => {
    mockApi.getJobClientThread.mockResolvedValue(null);
    await renderHook(() => useJobClientThread(undefined), {
      wrapper: withQuery(createTestQueryClient()),
    });
    expect(mockApi.getJobClientThread).not.toHaveBeenCalled();
  });
});

describe('useSendToClient', () => {
  beforeEach(() => mockEnqueueAction.mockClear());

  it('queues a text of its own kind, against the job and the client', async () => {
    const { result } = await renderHook(() => useSendToClient('deal-7', 'contact-9'), {
      wrapper: withQuery(createTestQueryClient()),
    });

    await result.current.send('  I am outside  ');

    expect(mockEnqueueAction).toHaveBeenCalledWith({
      // Not `chat`. What a line is addressed to is decided here, written to
      // disk, and never worked out again.
      kind: 'client_sms',
      dealId: 'deal-7',
      payload: { contactId: 'contact-9', body: 'I am outside' },
    });
  });

  // No conversation id anywhere in the row: `POST /messages` opens the thread
  // from the contact, so a first text works on a phone that has never seen it.
  it('carries no thread id, so the first text works underground', async () => {
    const { result } = await renderHook(() => useSendToClient('deal-7', 'contact-9'), {
      wrapper: withQuery(createTestQueryClient()),
    });

    await result.current.send('hello');
    const [[queued]] = mockEnqueueAction.mock.calls;
    expect(queued.payload).not.toHaveProperty('conversationId');
  });

  it('queues nothing for an empty box, or for a job with no client', async () => {
    const { result: empty } = await renderHook(
      () => useSendToClient('deal-7', 'contact-9'),
      { wrapper: withQuery(createTestQueryClient()) },
    );
    await empty.current.send('   ');

    const { result: nobody } = await renderHook(
      () => useSendToClient('deal-7', undefined),
      { wrapper: withQuery(createTestQueryClient()) },
    );
    await nobody.current.send('I am outside');

    expect(mockEnqueueAction).not.toHaveBeenCalled();
    expect(nobody.current.canSend).toBe(false);
  });
});
