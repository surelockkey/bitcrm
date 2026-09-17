import { renderHook, waitFor } from '@testing-library/react-native';
import type { InboxCounters, TeamChatCounters } from '@bitcrm/types';
import { ApiError } from '../../lib/api/errors';
import { createTestQueryClient, withQuery } from '../../test/query';
import * as api from './api';
import type { InboxConversation, TeamThread } from './api';
import { useConversation, useInbox, useMessagesBadge } from './inbox-hooks';

jest.mock('./api');

const mockApi = api as jest.Mocked<typeof api>;

const conversation = (over: Partial<InboxConversation> = {}): InboxConversation => ({
  id: 'conv-client',
  kind: 'client',
  partyKind: 'contact',
  partyId: 'contact-1',
  addresses: { phones: ['+15551234567'], emails: [] },
  state: 'open',
  unread: false,
  unreadCount: 0,
  flagged: false,
  lastMessageAt: '2026-09-16T12:10:00.000Z',
  lastMessagePreview: 'The gate code did not work',
  createdAt: '2026-09-01T09:00:00.000Z',
  updatedAt: '2026-09-16T12:10:00.000Z',
  ...over,
});

const teamThread = (over: Partial<TeamThread> = {}): TeamThread => ({
  ...conversation({
    id: 'conv-team',
    kind: 'team',
    partyKind: 'user',
    partyId: 'tech-1',
    lastMessageAt: '2026-09-16T18:00:00.000Z',
    lastMessagePreview: 'Gate code is 4021',
  }),
  viewerUnread: false,
  viewerUnreadCount: 0,
  ...over,
});

const inboxCounters = (over: Partial<InboxCounters> = {}): InboxCounters => ({
  unreadConversations: 0,
  flaggedConversations: 0,
  unreadByKind: {},
  totalConversations: 2,
  totalByKind: { client: 1, team: 1 },
  archivedConversations: 0,
  totalsRecountedAt: '2026-09-17T08:00:00.000Z',
  ...over,
});

const teamCounters = (over: Partial<TeamChatCounters> = {}): TeamChatCounters => ({
  unreadConversations: 0,
  unreadByKind: {},
  ...over,
});

const deals = [{ contactId: 'contact-1', clientName: { firstName: 'Ada', lastName: 'Byron' } }];

function setUp({
  conversations = [conversation()],
  threads = [teamThread()],
  counters = inboxCounters(),
  team = teamCounters(),
  listError,
  teamError,
}: {
  conversations?: InboxConversation[];
  threads?: TeamThread[];
  counters?: InboxCounters;
  team?: TeamChatCounters;
  listError?: unknown;
  teamError?: unknown;
} = {}) {
  mockApi.listConversations.mockImplementation(() =>
    listError ? Promise.reject(listError) : Promise.resolve({ data: conversations, pagination: {} }),
  );
  mockApi.listTeamThreads.mockImplementation(() =>
    teamError ? Promise.reject(teamError) : Promise.resolve({ data: threads, pagination: {} }),
  );
  mockApi.getInboxCounters.mockResolvedValue(counters);
  mockApi.getTeamChatCounters.mockResolvedValue(team);
}

const renderInbox = (category: Parameters<typeof useInbox>[0] = 'all', search = '') =>
  renderHook(() => useInbox(category, search, deals, true), {
    wrapper: withQuery(createTestQueryClient()),
  });

describe('useInbox', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setUp();
  });

  it('puts the office and the clients on one list, newest first', async () => {
    const { result } = await renderInbox();

    await waitFor(() => expect(result.current.rows).toHaveLength(2));
    expect(result.current.rows.map((r) => r.title)).toEqual(['Office', 'Ada Byron']);
  });

  it('narrows to the chip that is on', async () => {
    const { result } = await renderInbox('clients');

    await waitFor(() => expect(result.current.visible).toHaveLength(1));
    expect(result.current.visible[0]!.title).toBe('Ada Byron');
  });

  it('searches inside the chip, over what this phone has', async () => {
    const { result } = await renderInbox('all', 'gate code is');

    await waitFor(() => expect(result.current.rows).toHaveLength(2));
    expect(result.current.visible.map((r) => r.title)).toEqual(['Office']);
  });

  /**
   * The one number a technician sees in two places. The tab badge and the All
   * chip are computed by the same function from the same two payloads, so
   * they cannot drift apart.
   */
  it('gives the chips and the badge one number', async () => {
    setUp({
      counters: inboxCounters({ unreadConversations: 5, unreadByKind: { client: 2, team: 1 } }),
      team: teamCounters({ unreadConversations: 1, unreadByKind: { team: 1 } }),
    });
    const { result } = await renderInbox();
    const badge = await renderHook(() => useMessagesBadge(), {
      wrapper: withQuery(createTestQueryClient()),
    });

    await waitFor(() => expect(result.current.counts.all.unread).toBe(3));
    // Clients (2, the office's flag) + Team (1, the caller's own marker) —
    // never the inbox counters' own 5, which counts the office's flag on the
    // technician's own thread as well.
    expect(result.current.counts.clients.unread).toBe(2);
    expect(result.current.counts.team.unread).toBe(1);
    await waitFor(() => expect(badge.result.current).toBe('3'));
  });

  it('prints the category sizes the server reports', async () => {
    const { result } = await renderInbox();

    await waitFor(() => expect(result.current.counts.all.total).toBe(2));
    expect(result.current.counts.clients.total).toBe(1);
    expect(result.current.counts.clients.approximate).toBe(false);
  });

  it('leaves Requests out for a technician, who can never be handed one', async () => {
    const { result } = await renderInbox();

    await waitFor(() => expect(result.current.rows).toHaveLength(2));
    expect(result.current.categories).toEqual(['all', 'clients', 'team']);
  });

  /**
   * `GET /conversations` needs `messages.view`; `GET /team/conversations`
   * needs `team_chat.view`. An account with the second and not the first is
   * refused the client threads — and must be told so, not shown an empty list.
   */
  it('keeps the office thread and says why the rest is missing', async () => {
    setUp({ listError: new ApiError(403, 'outside your data scope') });
    const { result } = await renderInbox();

    await waitFor(() => expect(result.current.rows).toHaveLength(1));
    expect(result.current.rows[0]!.title).toBe('Office');
    expect(result.current.access.blocked).toBe(false);
    expect(result.current.access.notice).toMatch(/office thread/i);
    // Not also drawn as a network failure: one thing, one explanation.
    expect(result.current.staleError).toBeNull();
  });

  it('blocks the screen when nothing at all may be read', async () => {
    setUp({
      listError: new ApiError(403, 'nope'),
      teamError: new ApiError(403, 'nope'),
    });
    const { result } = await renderInbox();

    await waitFor(() => expect(result.current.access.blocked).toBe(true));
    expect(result.current.rows).toHaveLength(0);
  });

  it('shows the list it has and a strip, not an error page, with no signal', async () => {
    setUp({ listError: new ApiError(0, 'offline') });
    const { result } = await renderInbox();

    await waitFor(() => expect(result.current.staleError).toBeTruthy());
    expect(result.current.rows).toHaveLength(1);
    // A cached list answers the question the error would have, so the screen
    // keeps the list and wears a strip rather than an error page.
    expect(result.current.error).toBeNull();
  });

  it('takes the caller’s own read state over the office’s flag', async () => {
    const shared = teamThread({ unread: true, unreadCount: 9 });
    setUp({
      conversations: [conversation(), shared],
      threads: [{ ...shared, viewerUnread: false, viewerUnreadCount: 0 }],
    });
    const { result } = await renderInbox('team');

    await waitFor(() => expect(result.current.visible).toHaveLength(1));
    expect(result.current.visible[0]!.unread).toBe(false);
  });
});

describe('useConversation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setUp();
  });

  // The technician has just tapped that row; a spinner in front of it would be
  // a request for something already on the screen behind.
  it('answers from the list without asking the server again', async () => {
    const { result } = await renderHook(
      () => {
        useInbox('all', '', deals, true);
        return useConversation('conv-client');
      },
      { wrapper: withQuery(createTestQueryClient()) },
    );

    await waitFor(() => expect(result.current.conversation?.id).toBe('conv-client'));
    expect(mockApi.getConversation).not.toHaveBeenCalled();
  });

  it('fetches the one thread a link points at when the list is cold', async () => {
    mockApi.getConversation.mockResolvedValue(conversation({ id: 'conv-deep' }));
    const { result } = await renderHook(() => useConversation('conv-deep'), {
      wrapper: withQuery(createTestQueryClient()),
    });

    await waitFor(() => expect(result.current.conversation?.id).toBe('conv-deep'));
    expect(mockApi.getConversation).toHaveBeenCalledWith('conv-deep');
  });

  it('reports a refusal rather than an empty thread', async () => {
    mockApi.getConversation.mockRejectedValue(new ApiError(403, 'not yours'));
    const { result } = await renderHook(() => useConversation('conv-deep'), {
      wrapper: withQuery(createTestQueryClient()),
    });

    await waitFor(() => expect(result.current.error).toBeTruthy());
    expect(result.current.conversation).toBeUndefined();
  });
});
