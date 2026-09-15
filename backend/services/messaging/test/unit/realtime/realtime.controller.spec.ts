import { ForbiddenException } from '@nestjs/common';
import { Subject } from 'rxjs';
import { ConversationScopeService } from '../../../src/api/access/conversation-scope.service';
import { PermissionLookupService } from '../../../src/api/access/permission-lookup.service';
import { CountersService } from '../../../src/api/counters/counters.service';
import { type MessagingRealtimeEvent } from '../../../src/realtime/realtime-events';
import { RealtimeFilterService } from '../../../src/realtime/realtime-filter.service';
import { RealtimeController } from '../../../src/realtime/realtime.controller';
import { RealtimeSubscriber } from '../../../src/realtime/realtime.subscriber';
import { createMockConversation, T1 } from '../mocks';
import { ADMIN, TECH, adminPerms, createMockDeal, mockConversationsRepo, mockCountersRepo, mockDealRead, techPerms } from '../api/api-mocks';
import { flushMicrotasks, mockSseResponse } from './realtime-mocks';

function make(resolved: unknown = adminPerms()) {
  const subject = new Subject<MessagingRealtimeEvent>();
  const subscriber = { stream: () => subject.asObservable() } as unknown as RealtimeSubscriber;
  const repo = mockConversationsRepo();
  const deals = mockDealRead();
  const countersRepo = mockCountersRepo();
  const scope = new ConversationScopeService(repo as never, deals as never);
  const counters = new CountersService(countersRepo as never, scope);
  const filter = new RealtimeFilterService(scope, repo as never, counters);
  const permissions = { resolve: jest.fn().mockResolvedValue(resolved) } as unknown as PermissionLookupService;
  const controller = new RealtimeController(subscriber, filter, permissions, counters);
  return { controller, subject, permissions, repo, deals, countersRepo };
}

const CLIENT = createMockConversation({ id: 'c1', partyId: 'ct1', addresses: { phones: ['+14045551234'], emails: [] } });
const upserted = (c = CLIENT): MessagingRealtimeEvent => ({ type: 'conversation.upserted', at: T1, conversation: c });

describe('RealtimeController.stream (SSE)', () => {
  it('refuses a viewer with neither messages.view nor team_chat.view before opening the stream', async () => {
    const { controller } = make(null);
    const { res } = mockSseResponse();
    await expect(controller.stream(res as never, ADMIN)).rejects.toBeInstanceOf(ForbiddenException);
    expect(res.flushHeaders).not.toHaveBeenCalled();
  });

  it('sets unbuffered SSE headers, frames events, heartbeats, and tears down on close', async () => {
    jest.useFakeTimers();
    const { controller, subject } = make();
    const { res, chunks, frames, close } = mockSseResponse();

    await controller.stream(res as never, ADMIN);
    expect(res.headers).toMatchObject({ 'Content-Type': 'text/event-stream', 'X-Accel-Buffering': 'no', 'Cache-Control': 'no-cache' });
    expect(chunks[0]).toBe(': connected\n\n');

    subject.next(upserted());
    await flushMicrotasks();
    expect(frames()).toEqual([upserted()]);

    jest.advanceTimersByTime(26_000);
    expect(chunks).toContain(': hb\n\n');

    close();
    const count = chunks.length;
    subject.next(upserted());
    await flushMicrotasks();
    jest.advanceTimersByTime(30_000);
    expect(chunks.length).toBe(count);
    expect(res.end).toHaveBeenCalled();
    jest.useRealTimers();
  });

  it('masks numbers for a viewer without contacts.view_numbers', async () => {
    const perms = adminPerms({ permissions: { ...adminPerms().permissions, contacts: { view: true, view_numbers: false } } });
    const { controller, subject } = make(perms);
    const { res, frames } = mockSseResponse();
    await controller.stream(res as never, ADMIN);
    subject.next(upserted());
    await flushMicrotasks();
    expect(frames()[0].conversation.addresses.phones).toEqual([]);
    expect(frames()[0].conversation.phonesMasked).toBe(true);
  });

  it('drops events outside the technician’s scope and passes their own', async () => {
    const { controller, subject, deals } = make(techPerms());
    const { res, frames } = mockSseResponse();
    await controller.stream(res as never, TECH);

    subject.next(upserted());
    await flushMicrotasks();
    expect(frames()).toEqual([]);

    deals.listByTech.mockResolvedValue([createMockDeal({ contactId: 'ct1' })]);
    subject.next(upserted());
    await flushMicrotasks();
    expect(frames()).toHaveLength(1);
    expect(frames()[0].conversation.id).toBe('c1');
  });

  it('re-resolves permissions per event: a revoked viewer goes quiet', async () => {
    const { controller, subject, permissions } = make();
    const { res, frames } = mockSseResponse();
    await controller.stream(res as never, ADMIN);
    subject.next(upserted());
    await flushMicrotasks();
    expect(frames()).toHaveLength(1);

    (permissions.resolve as jest.Mock).mockResolvedValue(null);
    subject.next(upserted());
    await flushMicrotasks();
    expect(frames()).toHaveLength(1);
  });

  it('a failing lookup drops the event instead of leaking it', async () => {
    const { controller, subject, permissions } = make();
    const { res, frames } = mockSseResponse();
    await controller.stream(res as never, ADMIN);
    (permissions.resolve as jest.Mock).mockRejectedValue(new Error('redis blip'));
    subject.next(upserted());
    await flushMicrotasks();
    expect(frames()).toEqual([]);
  });

  it('counters for an assigned_only viewer are recounted over their threads, once per burst', async () => {
    jest.useFakeTimers();
    const { controller, subject, deals, repo, countersRepo } = make(techPerms());
    deals.listByTech.mockResolvedValue([createMockDeal({ contactId: 'ct1' })]);
    repo.getByParty.mockImplementation(async (kind: string, id: string) =>
      kind === 'contact' && id === 'ct1' ? createMockConversation({ id: 'c1', unread: true, unreadCount: 3 }) : null,
    );
    const { res, frames } = mockSseResponse();
    await controller.stream(res as never, TECH);

    const published: MessagingRealtimeEvent = { type: 'counters.changed', at: T1, counters: { unreadConversations: 99, flaggedConversations: 9, unreadByKind: {} } };
    subject.next(published);
    subject.next(published);
    subject.next(published);
    await flushMicrotasks(20);

    expect(frames()).toHaveLength(1);
    expect(frames()[0].type).toBe('counters.changed');
    expect(frames()[0].counters).toEqual({ unreadConversations: 1, flaggedConversations: 0, unreadByKind: { client: 1 } });
    expect(countersRepo.get).not.toHaveBeenCalled();

    // the burst collapses into one trailing recount after the cooldown
    jest.advanceTimersByTime(5_000);
    await flushMicrotasks(20);
    expect(frames()).toHaveLength(2);
    jest.useRealTimers();
  });

  it('counters for a full-scope viewer pass through as published', async () => {
    const { controller, subject } = make();
    const { res, frames } = mockSseResponse();
    await controller.stream(res as never, ADMIN);
    const published: MessagingRealtimeEvent = { type: 'counters.changed', at: T1, counters: { unreadConversations: 99, flaggedConversations: 9, unreadByKind: {} } };
    subject.next(published);
    await flushMicrotasks();
    expect(frames()).toEqual([published]);
  });
});

describe('RealtimeController.getCounters (polling fallback)', () => {
  it('wraps the scoped counters', async () => {
    const { controller } = make();
    expect(await controller.getCounters(ADMIN, adminPerms())).toEqual({
      success: true,
      data: { unreadConversations: 3, flaggedConversations: 1, unreadByKind: { client: 3 } },
    });
  });
});
