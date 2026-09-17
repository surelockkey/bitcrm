import type { InboxCounters, TeamChatCounters } from '@bitcrm/types';
import { ApiError } from '../../lib/api/errors';
import type { InboxConversation, TeamThread } from './api';
import {
  CATEGORY_ORDER,
  audienceOfKind,
  categoryOfKind,
  chipAccessibilityLabel,
  chipCount,
  chipLabel,
  chipUnread,
  describeInboxError,
  emptyStateFor,
  formatRowTime,
  inCategory,
  inboxAccess,
  inboxRows,
  messagesBadgeCount,
  partyNames,
  rowTitle,
  rowUnread,
  searchRows,
  visibleCategories,
  visibleRows,
} from './inbox-lib';

const conversation = (over: Partial<InboxConversation> = {}): InboxConversation => ({
  id: 'conv-1',
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
    lastMessagePreview: 'Gate code is 4021',
  }),
  viewerUnread: false,
  viewerUnreadCount: 0,
  ...over,
});

const counters = (over: Partial<InboxCounters> = {}): InboxCounters => ({
  unreadConversations: 0,
  flaggedConversations: 0,
  unreadByKind: {},
  totalConversations: 0,
  totalByKind: {},
  archivedConversations: 0,
  totalsRecountedAt: '2026-09-17T08:00:00.000Z',
  ...over,
});

const team = (over: Partial<TeamChatCounters> = {}): TeamChatCounters => ({
  unreadConversations: 0,
  unreadByKind: {},
  ...over,
});

describe('the chips', () => {
  it('names them in Workiz’s order and Workiz’s words', () => {
    expect(CATEGORY_ORDER).toEqual(['all', 'requests', 'clients', 'team']);
    expect(CATEGORY_ORDER.map((c) => chipLabel(c, { approximate: false, unread: 0 }))).toEqual([
      'All',
      'Requests',
      'Clients',
      'Team',
    ]);
  });

  // The web Inbox's mapping, kind for kind — a chip called "Clients" in a van
  // and a tab called "Clients" in the office must hold the same threads.
  it('maps kinds the way the web Inbox maps them', () => {
    expect(categoryOfKind('unknown')).toBe('requests');
    expect(categoryOfKind('client')).toBe('clients');
    expect(categoryOfKind('team')).toBe('team');
    expect(categoryOfKind('group')).toBe('team');
  });

  it('puts an outside company under All only — Workiz gives it no chip', () => {
    expect(categoryOfKind('external')).toBeUndefined();
    expect(inCategory('external', 'all')).toBe(true);
    expect(inCategory('external', 'clients')).toBe(false);
    expect(inCategory('external', 'team')).toBe(false);
  });

  it('keeps the office and a client apart, whatever the chip', () => {
    expect(audienceOfKind('team')).toBe('office');
    expect(audienceOfKind('group')).toBe('office');
    expect(audienceOfKind('client')).toBe('client');
    expect(audienceOfKind('unknown')).toBe('client');
    expect(audienceOfKind('external')).toBe('client');
  });
});

/**
 * Requests maps to the `unknown` kind — but a technician's scope builds the
 * inbox from contact / company / user / group pointers, and an `unknown`
 * thread is keyed by its address. The chip is therefore not "empty today", it
 * is unreachable, and an always-zero chip teaches a man to stop reading them.
 */
describe('which chips are drawn', () => {
  it('leaves Requests out for a viewer who can never have one', () => {
    expect(visibleCategories(counters(), ['team', 'client'])).toEqual([
      'all',
      'clients',
      'team',
    ]);
  });

  it('leaves it out before the counters have answered at all', () => {
    expect(visibleCategories(undefined)).toEqual(['all', 'clients', 'team']);
  });

  it('draws it for a viewer the server says has unknown threads', () => {
    expect(visibleCategories(counters({ totalByKind: { unknown: 4 } }))).toEqual([
      'all',
      'requests',
      'clients',
      'team',
    ]);
  });

  it('draws it on an unread even when the totals were never rebuilt', () => {
    const noTotals: InboxCounters = {
      unreadConversations: 1,
      flaggedConversations: 0,
      unreadByKind: { unknown: 1 },
    };
    expect(visibleCategories(noTotals)).toContain('requests');
  });

  it('draws it when a row of that kind is already on the list', () => {
    expect(visibleCategories(counters(), ['unknown'])).toContain('requests');
  });
});

/**
 * The two counters are not interchangeable. `GET /conversations/counters`
 * counts the office's team-wide `unread` flag; `GET /team/counters` counts
 * this caller's own `READ#` markers. A technician reading their office thread
 * moves only their own marker, so believing the first for the office thread
 * lights a badge their reading can never put out.
 */
describe('unread, assembled from the counters that know', () => {
  it('reads Team from the caller’s own markers, never the office’s flag', () => {
    const inbox = counters({ unreadConversations: 1, unreadByKind: { team: 1 } });
    expect(chipUnread('team', inbox, team({ unreadConversations: 0 }))).toBe(0);
  });

  it('still shows Team unread when only the caller’s marker is behind', () => {
    const inbox = counters({ unreadByKind: {} });
    expect(chipUnread('team', inbox, team({ unreadConversations: 2 }))).toBe(2);
  });

  it('reads Clients from the inbox counters', () => {
    expect(chipUnread('clients', counters({ unreadByKind: { client: 3 } }), team())).toBe(3);
  });

  it('counts every thread once, so All is exactly the sum of the chips', () => {
    const inbox = counters({
      // The office's flag on the technician's own thread is deliberately
      // ignored: the team counters already speak for that thread.
      unreadConversations: 9,
      unreadByKind: { team: 1, group: 1, client: 3, unknown: 2, external: 1 },
    });
    const mine = team({ unreadConversations: 2, unreadByKind: { team: 1, group: 1 } });

    const parts =
      chipUnread('team', inbox, mine) +
      chipUnread('clients', inbox, mine) +
      chipUnread('requests', inbox, mine);
    // External has no chip of its own but is still somebody writing in.
    expect(chipUnread('all', inbox, mine)).toBe(parts + 1);
  });

  it('gives the tab badge the All chip’s number, by construction', () => {
    const inbox = counters({ unreadByKind: { client: 3 } });
    const mine = team({ unreadConversations: 1 });
    expect(messagesBadgeCount(inbox, mine)).toBe(chipUnread('all', inbox, mine));
  });

  it('is zero, not a crash, before either counter has answered', () => {
    expect(messagesBadgeCount(undefined, undefined)).toBe(0);
  });
});

describe('what a chip prints', () => {
  it('prints the size of the category, which is what Workiz prints', () => {
    const inbox = counters({
      totalConversations: 12,
      totalByKind: { client: 9, team: 2, group: 1 },
    });
    expect(chipLabel('all', chipCount('all', inbox, team(), undefined))).toBe('All (12)');
    expect(chipLabel('clients', chipCount('clients', inbox, team(), undefined))).toBe(
      'Clients (9)',
    );
    // Team is `team` + `group` — two server kinds, one chip.
    expect(chipLabel('team', chipCount('team', inbox, team(), undefined))).toBe('Team (3)');
  });

  it('falls back to what this phone has loaded when the totals are not trustworthy', () => {
    const noTotals: InboxCounters = {
      unreadConversations: 0,
      flaggedConversations: 0,
      unreadByKind: {},
    };
    expect(chipLabel('all', chipCount('all', noTotals, team(), { count: 4, complete: true }))).toBe(
      'All (4)',
    );
  });

  it('marks a floor as a floor rather than claiming it is the total', () => {
    expect(
      chipLabel('all', chipCount('all', undefined, team(), { count: 50, complete: false })),
    ).toBe('All (50+)');
  });

  it('prints no brackets at all rather than a confident wrong nought', () => {
    expect(chipLabel('clients', chipCount('clients', undefined, team(), undefined))).toBe(
      'Clients',
    );
  });

  // The dot is a colour and says nothing out loud.
  it('reads the unread out for a screen reader', () => {
    const count = chipCount('clients', counters({ unreadByKind: { client: 2 } }), team(), {
      count: 5,
      complete: true,
    });
    expect(chipAccessibilityLabel('clients', count)).toBe('Clients (0), 2 unread');
  });
});

describe('the names on the rows', () => {
  it('builds the map from the jobs this phone already holds', () => {
    const names = partyNames([
      { contactId: 'contact-1', clientName: { firstName: 'Ada', lastName: 'Byron' } },
      { contactId: 'contact-1', clientName: { firstName: 'Stale', lastName: 'Copy' } },
      { contactId: 'contact-2', clientName: { firstName: 'Grace' } },
      { clientName: { firstName: 'No', lastName: 'Contact' } },
    ]);
    expect(names.get('contact-1')).toBe('Ada Byron');
    expect(names.get('contact-2')).toBe('Grace');
    expect(names.size).toBe(2);
  });

  it('names the office "Office", whoever is on shift', () => {
    expect(rowTitle(teamThread(), new Map())).toBe('Office');
  });

  it('names a client from the jobs, not from their digits', () => {
    expect(rowTitle(conversation(), new Map([['contact-1', 'Ada Byron']]))).toBe('Ada Byron');
  });

  it('falls back to the number a thread is carried on', () => {
    expect(rowTitle(conversation(), new Map())).toBe('+15551234567');
  });

  it('never invents digits for a viewer who may not see them', () => {
    const masked = conversation({ phonesMasked: true });
    expect(rowTitle(masked, new Map())).toBe('Client');
    expect(rowTitle({ ...masked, kind: 'unknown' }, new Map())).toBe('Unknown number');
  });

  it('names a group by its name', () => {
    expect(rowTitle(conversation({ kind: 'group', name: 'North vans' }), new Map())).toBe(
      'North vans',
    );
  });
});

describe('whether a row has something unread', () => {
  it('believes the team endpoint where it has spoken', () => {
    const c = conversation({ kind: 'team', unread: true, unreadCount: 4 });
    expect(rowUnread(c, { viewerUnread: false, viewerUnreadCount: 0 })).toEqual({
      unread: false,
      unreadCount: 0,
    });
  });

  it('falls back to the thread’s own flag for a client', () => {
    const c = conversation({ unread: true, unreadCount: 2 });
    expect(rowUnread(c, undefined)).toEqual({ unread: true, unreadCount: 2 });
  });
});

describe('the list', () => {
  it('is newest activity first', () => {
    const rows = inboxRows(
      [
        conversation({ id: 'old', lastMessageAt: '2026-09-10T08:00:00.000Z' }),
        conversation({ id: 'new', lastMessageAt: '2026-09-16T18:00:00.000Z' }),
      ],
      [],
      new Map(),
    );
    expect(rows.map((r) => r.id)).toEqual(['new', 'old']);
  });

  it('takes the caller’s own read state from the team copy, not the office’s flag', () => {
    const shared = teamThread({ unread: true, unreadCount: 6 });
    const rows = inboxRows(
      [shared],
      [{ ...shared, viewerUnread: true, viewerUnreadCount: 2 }],
      new Map(),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ unread: true, unreadCount: 2 });
  });

  /**
   * An account with `team_chat.view` and no `messages.view` is refused the
   * inbox route entirely. The office thread still loads, and it must be on
   * the list — a Messages screen that is empty for a man who has messages is
   * the failure this whole screen exists to avoid.
   */
  it('keeps the office thread even when the inbox route returned nothing', () => {
    const rows = inboxRows([], [teamThread()], new Map());
    expect(rows.map((r) => r.title)).toEqual(['Office']);
    expect(rows[0]!.audience).toBe('office');
  });

  it('says which thread a row is, in words, before it is opened', () => {
    const rows = inboxRows(
      [conversation()],
      [teamThread()],
      new Map([['contact-1', 'Ada Byron']]),
    );
    expect(rows.map((r) => r.tag).sort()).toEqual(['Client', 'Office']);
  });

  it('carries the job a client thread last touched — the way into texting them', () => {
    const rows = inboxRows([conversation({ lastDealId: 'deal-7' })], [], new Map());
    expect(rows[0]!.dealId).toBe('deal-7');
  });

  it('draws a thread with nothing in it without a time or a preview', () => {
    const rows = inboxRows(
      [conversation({ lastMessageAt: undefined, lastMessagePreview: undefined })],
      [],
      new Map(),
    );
    expect(rows[0]).toMatchObject({ time: '', preview: '' });
  });
});

describe('the search', () => {
  const rows = inboxRows(
    [
      conversation({ id: 'a', partyId: 'contact-1' }),
      conversation({
        id: 'b',
        partyId: 'contact-2',
        addresses: { phones: ['+15559876543'], emails: [] },
        lastMessagePreview: 'Running late',
      }),
    ],
    [teamThread()],
    new Map([['contact-1', 'Ada Byron']]),
  );

  it('finds a name', () => {
    expect(searchRows(rows, 'ada').map((r) => r.id)).toEqual(['a']);
  });

  it('finds words in the last message', () => {
    expect(searchRows(rows, 'running').map((r) => r.id)).toEqual(['b']);
  });

  // A technician types the digits off a job sheet, not the punctuation.
  it('finds a number typed without its punctuation', () => {
    expect(searchRows(rows, '555 987').map((r) => r.id)).toEqual(['b']);
  });

  it('gives everything back for an empty box', () => {
    expect(searchRows(rows, '   ')).toHaveLength(rows.length);
  });

  it('narrows inside the chip that is on, never across it', () => {
    expect(visibleRows(rows, 'team', '')).toHaveLength(1);
    expect(visibleRows(rows, 'clients', 'ada').map((r) => r.id)).toEqual(['a']);
    expect(visibleRows(rows, 'team', 'ada')).toHaveLength(0);
  });
});

describe('the clock on a row', () => {
  const now = new Date('2026-09-17T15:00:00.000Z');

  it('shows the clock for today', () => {
    expect(formatRowTime('2026-09-17T09:30:00.000Z', now)).toMatch(/\d/);
  });

  it('names yesterday rather than dating it', () => {
    expect(formatRowTime('2026-09-16T09:30:00.000Z', now)).toBe('Yesterday');
  });

  it('gives an older day its weekday, and an older year its year', () => {
    expect(formatRowTime('2026-09-14T09:30:00.000Z', now)).toMatch(/Sep 14/);
    expect(formatRowTime('2025-09-14T09:30:00.000Z', now)).toMatch(/2025/);
  });

  it('says nothing about a thread nobody has written in', () => {
    expect(formatRowTime(undefined, now)).toBe('');
    expect(formatRowTime('not a date', now)).toBe('');
  });
});

/**
 * A refusal must never be drawn as an empty list. "No results found" over a
 * 403 tells a man there are no messages when what happened is that he was not
 * allowed to ask.
 */
describe('what this account may see', () => {
  const forbidden = new ApiError(403, 'Conversation is outside your data scope');

  it('is not blocked when everything loaded', () => {
    expect(inboxAccess(null, null, true)).toEqual({ blocked: false, clientsRefused: false });
  });

  it('keeps the list going on the office thread when the inbox route is refused', () => {
    const access = inboxAccess(forbidden, null, true);
    expect(access.blocked).toBe(false);
    expect(access.clientsRefused).toBe(true);
    expect(access.notice).toMatch(/office thread/i);
  });

  it('blocks the screen when both were refused', () => {
    expect(inboxAccess(forbidden, forbidden, false).blocked).toBe(true);
  });

  it('blocks it when the inbox is refused and there is no office thread to fall back on', () => {
    expect(inboxAccess(forbidden, null, false).blocked).toBe(true);
  });

  it('treats an expired session the same as a refusal, not as a broken list', () => {
    expect(inboxAccess(new ApiError(401, 'no'), null, true).clientsRefused).toBe(true);
  });

  // No signal is not a permissions problem and must not be described as one.
  it('does not read a dropped connection as a refusal', () => {
    expect(inboxAccess(new ApiError(0, 'offline'), null, true)).toEqual({
      blocked: false,
      clientsRefused: false,
    });
  });
});

describe('why the list would not load', () => {
  it('says no signal, and that what is written now still goes', () => {
    expect(describeInboxError(new ApiError(0, 'offline')).title).toBe('No signal');
  });

  it('says a refusal is about the role, not about the phone', () => {
    expect(describeInboxError(new ApiError(403, 'nope')).body).toMatch(/role/i);
  });

  it('passes the server’s own words through for anything else', () => {
    expect(describeInboxError(new ApiError(500, 'Kaboom')).body).toBe('Kaboom');
  });
});

describe('the empty states', () => {
  // Workiz says exactly this on this screen, and nothing else.
  it('uses Workiz’s words at the top of every one', () => {
    for (const cat of CATEGORY_ORDER) {
      expect(emptyStateFor(cat, false).title).toBe('No results found');
      expect(emptyStateFor(cat, true).title).toBe('No results found');
    }
  });

  it('says where a client thread comes from, since it cannot be started here', () => {
    expect(emptyStateFor('clients', false).body).toMatch(/Open a job/);
  });

  it('says a search only reaches what this phone has', () => {
    expect(emptyStateFor('all', true).body).toMatch(/on this phone/i);
  });
});
