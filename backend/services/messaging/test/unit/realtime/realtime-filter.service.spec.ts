import { ConversationScopeService } from '../../../src/api/access/conversation-scope.service';
import { CountersService } from '../../../src/api/counters/counters.service';
import { type MessagingRealtimeEvent } from '../../../src/realtime/realtime-events';
import { RealtimeFilterService, throttleTrailing } from '../../../src/realtime/realtime-filter.service';
import { REALTIME_EVENT_TYPES, isRealtimeEvent } from '../../../src/realtime/realtime-events';
import { TeamCountersService } from '../../../src/team/team-counters.service';
import { createMockConversation, createMockMessage, T1 } from '../mocks';
import { ADMIN, TECH, adminPerms, createMockDeal, mockConversationsRepo, mockCountersRepo, mockDealRead, techPerms } from '../api/api-mocks';

function make(opts: { team?: boolean } = { team: true }) {
  const repo = mockConversationsRepo();
  const deals = mockDealRead();
  const countersRepo = mockCountersRepo();
  const scope = new ConversationScopeService(repo as never, deals as never);
  const counters = new CountersService(countersRepo as never, scope);
  const teamCounters = opts.team === false ? undefined : new TeamCountersService(repo as never);
  const filter = new RealtimeFilterService(scope, repo as never, counters, teamCounters);
  return { filter, repo, deals, countersRepo };
}

const CLIENT = createMockConversation({ id: 'c1', partyId: 'ct1', addresses: { phones: ['+14045551234'], emails: [] } });
const TEAM_MINE = createMockConversation({ id: 'c-me', kind: 'team', partyKind: 'user', partyId: 'tech-1', addresses: { phones: [], emails: [] } });
const upserted = (c = CLIENT): MessagingRealtimeEvent => ({ type: 'conversation.upserted', at: T1, conversation: c });
const COUNTERS: MessagingRealtimeEvent = { type: 'counters.changed', at: T1, counters: { unreadConversations: 9, flaggedConversations: 4, unreadByKind: { client: 9 } } };

describe('RealtimeFilterService.viewerFor / mayConnect', () => {
  it('derives the flags from the resolved permissions; nothing resolved → may not connect', () => {
    const { filter } = make();
    const admin = filter.viewerFor(ADMIN, adminPerms());
    expect(admin).toMatchObject({ mayViewMessages: true, mayViewTeamChat: true, seesNumbers: true, scope: { scope: 'all' } });
    expect(filter.mayConnect(admin)).toBe(true);

    const tech = filter.viewerFor(TECH, techPerms());
    expect(tech).toMatchObject({ seesNumbers: false, scope: { scope: 'assigned_only', userId: 'tech-1' } });

    const nobody = filter.viewerFor(TECH, null);
    expect(filter.mayConnect(nobody)).toBe(false);
  });

  it('team_chat.view alone may connect', () => {
    const { filter } = make();
    const chatOnly = filter.viewerFor(TECH, techPerms({ permissions: { team_chat: { view: true } } }));
    expect(chatOnly.mayViewMessages).toBe(false);
    expect(filter.mayConnect(chatOnly)).toBe(true);
  });
});

describe('RealtimeFilterService.forViewer — conversation.upserted', () => {
  it('passes unmasked to a full-scope viewer with numbers', async () => {
    const { filter } = make();
    const out = await filter.forViewer(upserted(), filter.viewerFor(ADMIN, adminPerms()));
    expect(out).toEqual(upserted());
  });

  it('masks for a viewer without contacts.view_numbers, on a copy', async () => {
    const { filter } = make();
    const perms = adminPerms({ permissions: { ...adminPerms().permissions, contacts: { view: true, view_numbers: false } } });
    const out = (await filter.forViewer(upserted(), filter.viewerFor(ADMIN, perms))) as Extract<MessagingRealtimeEvent, { type: 'conversation.upserted' }>;
    expect(out.conversation.addresses.phones).toEqual([]);
    expect((out.conversation as { phonesMasked?: true }).phonesMasked).toBe(true);
    expect(CLIENT.addresses.phones).toEqual(['+14045551234']);
  });

  it('drops a thread outside the technician’s scope, passes their own job’s thread masked', async () => {
    const { filter, deals } = make();
    const tech = filter.viewerFor(TECH, techPerms());
    expect(await filter.forViewer(upserted(), tech)).toBeNull();
    deals.listByTech.mockResolvedValue([createMockDeal({ contactId: 'ct1' })]);
    const out = await filter.forViewer(upserted(), tech);
    expect(out).not.toBeNull();
    expect((out as any).conversation.phonesMasked).toBe(true);
  });

  it('a team_chat-only viewer gets team threads in scope and no client threads', async () => {
    const { filter } = make();
    const chatOnly = filter.viewerFor(TECH, techPerms({ permissions: { team_chat: { view: true } } }));
    expect(await filter.forViewer(upserted(TEAM_MINE), chatOnly)).toEqual(upserted(TEAM_MINE));
    expect(await filter.forViewer(upserted(createMockConversation({ kind: 'team', partyKind: 'user', partyId: 'tech-2' })), chatOnly)).toBeNull();
    expect(await filter.forViewer(upserted(), chatOnly)).toBeNull();
  });

  it('drops when the scope check itself throws', async () => {
    const { filter, deals } = make();
    deals.listByTech.mockRejectedValue(new Error('boom'));
    expect(await filter.forViewer(upserted(), filter.viewerFor(TECH, techPerms()))).toBeNull();
  });
});

describe('RealtimeFilterService.forViewer — message.upserted', () => {
  const message = createMockMessage({ conversationId: 'c1' });

  it('uses the carried conversation for scoping and masks both parts', async () => {
    const { filter, repo } = make();
    const perms = adminPerms({ permissions: { ...adminPerms().permissions, contacts: { view: true, view_numbers: false } } });
    const out = (await filter.forViewer({ type: 'message.upserted', at: T1, message, conversation: CLIENT }, filter.viewerFor(ADMIN, perms))) as any;
    expect(repo.get).not.toHaveBeenCalled();
    expect(out.message.from).toBeUndefined();
    expect(out.message.fromMasked).toBe(true);
    expect(out.conversation.phonesMasked).toBe(true);
  });

  it('looks the conversation up when the event did not carry it; unknown → dropped', async () => {
    const { filter, repo } = make();
    const admin = filter.viewerFor(ADMIN, adminPerms());
    expect(await filter.forViewer({ type: 'message.upserted', at: T1, message }, admin)).toBeNull();
    repo.get.mockResolvedValue(CLIENT);
    const out = (await filter.forViewer({ type: 'message.upserted', at: T1, message }, admin)) as any;
    expect(repo.get).toHaveBeenCalledWith('c1');
    expect(out.conversation.id).toBe('c1');
    expect(out.message.from).toBe('+14045551234');
  });
});

describe('RealtimeFilterService.forViewer — counters.changed', () => {
  it('full scope gets the company-wide numbers as published', async () => {
    const { filter } = make();
    expect(await filter.forViewer(COUNTERS, filter.viewerFor(ADMIN, adminPerms()))).toBe(COUNTERS);
  });

  it('assigned_only gets a recount over their own threads, never the published numbers', async () => {
    const { filter, deals, repo, countersRepo } = make();
    deals.listByTech.mockResolvedValue([createMockDeal({ contactId: 'ct1' })]);
    repo.getByParty.mockImplementation(async (kind: string, id: string) =>
      kind === 'contact' && id === 'ct1' ? createMockConversation({ id: 'c1', unread: true, unreadCount: 1 }) : null,
    );
    const out = (await filter.forViewer(COUNTERS, filter.viewerFor(TECH, techPerms()))) as any;
    expect(out.counters).toMatchObject({
      unreadConversations: 1,
      flaggedConversations: 0,
      unreadByKind: { client: 1 },
      // The scoped recount walks the rows, so it carries exact totals too.
      totalConversations: 1,
      totalByKind: { client: 1 },
      archivedConversations: 0,
    });
    expect(countersRepo.get).not.toHaveBeenCalled();
  });

  it('is dropped for a viewer without messages.view', async () => {
    const { filter } = make();
    const chatOnly = filter.viewerFor(TECH, techPerms({ permissions: { team_chat: { view: true } } }));
    expect(await filter.forViewer(COUNTERS, chatOnly)).toBeNull();
  });
});

describe('RealtimeFilterService.forViewer — opt_out.changed', () => {
  const event: MessagingRealtimeEvent = { type: 'opt_out.changed', at: T1, channel: 'sms', address: '+14045551234', status: 'opted_out', conversationId: 'c1' };

  it('passes with the address to a viewer with numbers, without it otherwise (conversationId kept)', async () => {
    const { filter } = make();
    expect(await filter.forViewer(event, filter.viewerFor(ADMIN, adminPerms()))).toBe(event);
    const masked = (await filter.forViewer(event, filter.viewerFor(TECH, techPerms()))) as any;
    expect(masked.address).toBeUndefined();
    expect(masked.conversationId).toBe('c1');
    expect(masked.status).toBe('opted_out');
  });

  it('an email opt-out is never masked; dropped without messages.view', async () => {
    const { filter } = make();
    const email = { ...event, channel: 'email' as const, address: 'jane@example.com' };
    expect(await filter.forViewer(email, filter.viewerFor(TECH, techPerms()))).toBe(email);
    expect(await filter.forViewer(event, filter.viewerFor(TECH, techPerms({ permissions: { team_chat: { view: true } } })))).toBeNull();
  });
});

describe('throttleTrailing', () => {
  it('runs at once, collapses a burst into one trailing run, and can be cancelled', async () => {
    jest.useFakeTimers();
    const fn = jest.fn().mockResolvedValue(undefined);
    const t = throttleTrailing(fn, 1000);

    t.call();
    await Promise.resolve();
    expect(fn).toHaveBeenCalledTimes(1);

    t.call();
    t.call();
    t.call();
    expect(fn).toHaveBeenCalledTimes(1);

    // let the first run's finally() schedule the cooldown, then expire it
    for (let i = 0; i < 6; i++) await Promise.resolve();
    jest.advanceTimersByTime(1000);
    for (let i = 0; i < 6; i++) await Promise.resolve();
    expect(fn).toHaveBeenCalledTimes(2);

    t.cancel();
    t.call();
    jest.advanceTimersByTime(5000);
    for (let i = 0; i < 6; i++) await Promise.resolve();
    expect(fn).toHaveBeenCalledTimes(2);
    jest.useRealTimers();
  });

  it('a throwing fn does not break the throttle', async () => {
    jest.useFakeTimers();
    const fn = jest.fn().mockRejectedValueOnce(new Error('x')).mockResolvedValue(undefined);
    const t = throttleTrailing(fn, 100);
    t.call();
    for (let i = 0; i < 6; i++) await Promise.resolve();
    jest.advanceTimersByTime(100);
    for (let i = 0; i < 6; i++) await Promise.resolve();
    t.call();
    await Promise.resolve();
    expect(fn).toHaveBeenCalledTimes(2);
    t.cancel();
    jest.useRealTimers();
  });
});

describe('RealtimeFilterService.forViewer — team chat (§6)', () => {
  const GROUP = createMockConversation({ id: 'g1', kind: 'group', partyKind: 'group', partyId: 'g1', memberIds: ['tech-1', 'admin-1'], addresses: { phones: [], emails: [] }, lastMessageAt: T1, lastMessageId: 'm9', lastDirection: 'outbound' });
  const invalidated: MessagingRealtimeEvent = { type: 'team_counters.invalidated', at: T1, conversationId: 'g1', memberIds: ['tech-1'] };

  it('the new event types are accepted off the wire', () => {
    expect(REALTIME_EVENT_TYPES).toEqual(expect.arrayContaining(['team_counters.invalidated', 'team_counters.changed']));
    expect(isRealtimeEvent(invalidated)).toBe(true);
  });

  it('a group line reaches its members (memberIds) with recipients and mentions intact, and not a non-member technician', async () => {
    const { filter } = make();
    const message = createMockMessage({ conversationId: 'g1', channel: 'in_app', from: undefined, to: undefined, mentions: ['tech-1'] });
    const event: MessagingRealtimeEvent = { type: 'message.upserted', at: T1, message, conversation: GROUP, recipients: ['tech-1', 'admin-1'], mentions: ['tech-1'] };
    const out = (await filter.forViewer(event, filter.viewerFor(TECH, techPerms({ permissions: { team_chat: { view: true } } })))) as any;
    expect(out).toMatchObject({ recipients: ['tech-1', 'admin-1'], mentions: ['tech-1'] });
    expect(out.message.mentions).toEqual(['tech-1']);
    expect(await filter.forViewer({ ...event, conversation: { ...GROUP, memberIds: ['admin-1'] } }, filter.viewerFor(TECH, techPerms()))).toBeNull();
  });

  it('team_counters.invalidated becomes the listed member’s own recount, and nothing for anyone else', async () => {
    const { filter, repo } = make();
    repo.listMemberOf.mockResolvedValue([{ conversationId: 'g1', userId: 'tech-1', role: 'member', joinedAt: '2026-09-01T00:00:00.000Z' }]);
    repo.get.mockResolvedValue(GROUP);
    const out = await filter.forViewer(invalidated, filter.viewerFor(TECH, techPerms()));
    expect(out).toEqual({ type: 'team_counters.changed', at: T1, userId: 'tech-1', counters: { unreadConversations: 1, unreadByKind: { group: 1 } } });

    expect(await filter.forViewer(invalidated, filter.viewerFor(ADMIN, adminPerms()))).toBeNull(); // not listed
    expect(await filter.forViewer(invalidated, filter.viewerFor(TECH, techPerms({ permissions: { messages: { view: true } } })))).toBeNull(); // no team_chat.view
    const bare = make({ team: false }); // no recount service wired → nothing to say
    expect(await bare.filter.forViewer(invalidated, bare.filter.viewerFor(TECH, techPerms()))).toBeNull();
  });

  it('a team_counters.changed already on the bus goes only to its own user', async () => {
    const { filter } = make();
    const changed: MessagingRealtimeEvent = { type: 'team_counters.changed', at: T1, userId: 'tech-1', counters: { unreadConversations: 2, unreadByKind: { team: 1, group: 1 } } };
    expect(await filter.forViewer(changed, filter.viewerFor(TECH, techPerms()))).toBe(changed);
    expect(await filter.forViewer(changed, filter.viewerFor(ADMIN, adminPerms()))).toBeNull();
  });
});
