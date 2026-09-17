import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { renderScreen } from '../../test/render';
import { InboxScreen } from './inbox-screen';
import type { UseInboxResult } from './inbox-hooks';
import type { ChipCount, InboxCategory, InboxRow } from './inbox-lib';

const mockRefetch = jest.fn();
const mockFetchNextPage = jest.fn();
let mockInbox: UseInboxResult;
/** Whatever the screen asked for last — the chip and the search box drive it. */
let asked: { category: InboxCategory; search: string };

jest.mock('../jobs/hooks', () => ({ useMyJobs: () => ({ deals: [] }) }));
jest.mock('./inbox-hooks', () => ({
  useInbox: (category: InboxCategory, search: string) => {
    asked = { category, search };
    return mockInbox;
  },
}));

const row = (over: Partial<InboxRow> = {}): InboxRow => ({
  id: 'conv-team',
  kind: 'team',
  category: 'team',
  audience: 'office',
  title: 'Office',
  tag: 'Office',
  preview: 'Gate code is 4021',
  time: '12:10 PM',
  unread: false,
  unreadCount: 0,
  activityAt: '2026-09-16T12:10:00.000Z',
  ...over,
});

const count = (over: Partial<ChipCount> = {}): ChipCount => ({
  total: 0,
  approximate: false,
  unread: 0,
  ...over,
});

const inbox = (over: Partial<UseInboxResult> = {}): UseInboxResult => {
  const rows = over.rows ?? [row()];
  return {
    rows,
    visible: over.visible ?? rows,
    categories: ['all', 'clients', 'team'],
    counts: {
      all: count({ total: 2 }),
      requests: count(),
      clients: count({ total: 1 }),
      team: count({ total: 1 }),
    },
    access: { blocked: false, clientsRefused: false },
    loading: false,
    isRefetching: false,
    error: null,
    staleError: null,
    hasNextPage: false,
    isFetchingNextPage: false,
    fetchNextPage: mockFetchNextPage,
    refetch: mockRefetch,
    ...over,
  };
};

const render = (props: Partial<React.ComponentProps<typeof InboxScreen>> = {}) =>
  renderScreen(<InboxScreen onOpenThread={jest.fn()} {...props} />);

describe('InboxScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockInbox = inbox();
    asked = { category: 'all', search: '' };
  });

  it.each(['light', 'dark'] as const)('draws the list in the %s theme', async (scheme) => {
    await renderScreen(<InboxScreen onOpenThread={jest.fn()} />, { scheme });

    expect(screen.getByTestId('inbox-screen')).toBeTruthy();
    expect(screen.getByText('Messages')).toBeTruthy();
    expect(screen.getByText('Gate code is 4021')).toBeTruthy();
  });

  // Workiz's own chips, in Workiz's order, with the size of each in brackets.
  it('draws the chips Workiz draws, with their counts', async () => {
    await render();

    expect(screen.getByTestId('chip-all')).toBeTruthy();
    expect(screen.getByText('All (2)')).toBeTruthy();
    expect(screen.getByText('Clients (1)')).toBeTruthy();
    expect(screen.getByText('Team (1)')).toBeTruthy();
  });

  it('leaves Requests out when this viewer can never have one', async () => {
    await render();
    expect(screen.queryByTestId('chip-requests')).toBeNull();
  });

  it('draws Requests when the viewer does have them', async () => {
    mockInbox = inbox({ categories: ['all', 'requests', 'clients', 'team'] });
    await render();
    expect(screen.getByTestId('chip-requests')).toBeTruthy();
  });

  it('marks a chip that has something unread', async () => {
    mockInbox = inbox({
      counts: {
        ...inbox().counts,
        clients: count({ total: 1, unread: 2 }),
      },
    });
    await render();

    expect(screen.getByTestId('chip-clients-unread')).toBeTruthy();
    expect(screen.queryByTestId('chip-team-unread')).toBeNull();
  });

  it('changes the filter when a chip is tapped', async () => {
    await render();

    await fireEvent.press(screen.getByTestId('chip-clients'));
    await waitFor(() => expect(asked.category).toBe('clients'));
  });

  it('passes what is typed in the box down to the filter', async () => {
    await render();

    await fireEvent.changeText(screen.getByTestId('inbox-search'), 'byron');
    await waitFor(() => expect(asked.search).toBe('byron'));
  });

  /**
   * The one mistake this screen must make impossible: the office and a client
   * sit one under the other, so each row says which it is before it is opened.
   */
  it('says in words whether a row is the office or a client', async () => {
    mockInbox = inbox({
      rows: [
        row(),
        row({
          id: 'conv-client',
          kind: 'client',
          category: 'clients',
          audience: 'client',
          title: 'Ada Byron',
          tag: 'Client',
          preview: 'The gate code did not work',
        }),
      ],
    });
    await render();

    expect(screen.getByTestId('conversation-conv-team-tag').props.children).toBe('Office');
    expect(screen.getByTestId('conversation-conv-client-tag').props.children).toBe('Client');
  });

  it('opens the thread the row stands for', async () => {
    const onOpenThread = jest.fn();
    await render({ onOpenThread });

    await fireEvent.press(screen.getByTestId('conversation-conv-team'));
    expect(onOpenThread).toHaveBeenCalledWith(expect.objectContaining({ id: 'conv-team' }));
  });

  it('marks an unread row', async () => {
    mockInbox = inbox({ rows: [row({ unread: true, unreadCount: 3 })] });
    await render();
    expect(screen.getByTestId('conversation-conv-team-unread')).toBeTruthy();
  });

  it('says Workiz’s words when nothing matches', async () => {
    mockInbox = inbox({ rows: [], visible: [] });
    await render();
    expect(screen.getByText('No results found')).toBeTruthy();
  });

  /**
   * A refusal drawn as an empty list tells a man there are no messages when
   * what happened is that he was not allowed to ask.
   */
  it('says the account cannot read the inbox rather than showing it empty', async () => {
    mockInbox = inbox({
      rows: [],
      visible: [],
      access: { blocked: true, clientsRefused: true },
    });
    await render();

    expect(screen.getByTestId('inbox-blocked')).toBeTruthy();
    expect(screen.queryByTestId('inbox-empty')).toBeNull();
  });

  it('keeps the office thread and explains the gap when only the inbox is refused', async () => {
    mockInbox = inbox({
      access: {
        blocked: false,
        clientsRefused: true,
        notice: 'This account can only open the office thread.',
      },
    });
    await render();

    expect(screen.getByTestId('inbox-partial')).toBeTruthy();
    expect(screen.getByTestId('inbox-list')).toBeTruthy();
  });

  it('keeps the list and wears a strip when the refresh could not reach the server', async () => {
    mockInbox = inbox({ staleError: new Error('offline') });
    await render();

    expect(screen.getByTestId('inbox-stale')).toBeTruthy();
    expect(screen.getByTestId('inbox-list')).toBeTruthy();
  });

  it('offers a retry when there is nothing at all to show', async () => {
    mockInbox = inbox({ rows: [], visible: [], error: new Error('boom') });
    await render();

    await fireEvent.press(screen.getByText('Try again'));
    expect(mockRefetch).toHaveBeenCalled();
  });

  it('offers older conversations as a button, not only as a scroll', async () => {
    mockInbox = inbox({ hasNextPage: true });
    await render();

    await fireEvent.press(screen.getByTestId('inbox-load-older'));
    expect(mockFetchNextPage).toHaveBeenCalled();
  });
});
