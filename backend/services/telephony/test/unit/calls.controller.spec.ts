import { BadRequestException } from '@nestjs/common';
import { Subject } from 'rxjs';
import { CallsController } from '../../src/calls/calls.controller';
import { CallsService } from '../../src/calls/calls.service';
import { CallEventsBus, type CallEvent } from '../../src/calls/call-events.bus';
import { ConferenceService } from '../../src/voice/conference.service';
import { type TelephonyConfig } from '../../src/telephony/telephony.config';
import { type CallRecord } from '../../src/calls/calls.repository';
import { type JwtUser } from '@bitcrm/types';

const CONFIG = {
  accountSid: 'AC00000000000000000000000000000000',
  authToken: 'the-auth-token',
} as TelephonyConfig;

const USER = { id: 'sup-1' } as JwtUser;

const record = (over: Partial<CallRecord> = {}): CallRecord => ({
  callSid: 'CA1',
  status: 'completed',
  startedAt: '2026-08-05T10:00:00.000Z',
  updatedAt: '2026-08-05T10:00:00.000Z',
  ...over,
});

function makeController(over: Partial<Record<string, unknown>> = {}) {
  const subject = new Subject<CallEvent>();
  const calls = {
    list: jest.fn().mockResolvedValue({ items: [record()], nextCursor: 'cur2' }),
    listLive: jest.fn().mockResolvedValue([record({ status: 'in-progress' })]),
    listByAgent: jest.fn().mockResolvedValue([]),
    getBySid: jest.fn().mockResolvedValue(record()),
    // Freezing the association is fire-and-forget from the read path.
    freezeParties: jest.fn().mockResolvedValue(undefined),
    setPartiesManually: jest.fn().mockResolvedValue(undefined),
    activeCallFor: jest.fn().mockResolvedValue(null),
    listByParty: jest.fn().mockResolvedValue({ items: [] }),
    ...over,
  } as unknown as CallsService;
  const bus = { stream: () => subject.asObservable() } as unknown as CallEventsBus;
  const conference = {
    grantMonitor: jest.fn().mockResolvedValue(undefined),
    addParticipant: jest.fn().mockResolvedValue({ callSid: 'CAadded' }),
    releaseAgentLeg: jest.fn().mockResolvedValue(undefined),
    removeParticipant: jest.fn().mockResolvedValue(undefined),
    legsOf: jest.fn().mockResolvedValue([]),
    releaseLeg: jest.fn().mockResolvedValue(undefined),
    promoteLeg: jest.fn().mockResolvedValue(undefined),
    ...(over.conference as object),
  } as unknown as ConferenceService;
  const userNames = {
    resolve: jest.fn().mockResolvedValue({}),
  } as unknown as import('../../src/common/user-names.service').UserNamesService;
  const contacts = {
    resolve: jest.fn().mockResolvedValue({}),
  } as unknown as import('../../src/common/contact-lookup.service').ContactLookupService;
  const userPhones = {
    resolve: jest.fn().mockResolvedValue({}),
  } as unknown as import('../../src/common/user-phone-lookup.service').UserPhoneLookupService;
  const directory = {
    list: jest.fn().mockResolvedValue([]),
    find: jest.fn().mockResolvedValue({ id: 'u9', name: 'Tamir Levi' }),
  } as unknown as import('../../src/common/user-directory.service').UserDirectoryService;
  // Defaults to granted, so every pre-masking assertion keeps its meaning.
  // Pass `permissions` to makeController() to exercise a masked viewer.
  const permissions = {
    maySeeClientNumbers: jest.fn().mockResolvedValue(true),
    ...(over.permissions as object),
  } as unknown as import('../../src/common/permission-lookup.service').PermissionLookupService;
  const bridge = {
    prepare: jest.fn(),
    context: jest.fn().mockResolvedValue(null),
    release: jest.fn().mockResolvedValue(undefined),
    answerClaim: jest.fn().mockResolvedValue(null),
    mayReachDeal: jest.fn().mockReturnValue(true),
    ...(over.bridge as object),
  } as unknown as import('../../src/common/bridge.service').BridgeService;
  const presence = {
    listOnline: jest.fn().mockResolvedValue([]),
    ...(over.presence as object),
  } as unknown as import('../../src/presence/presence.service').PresenceService;
  const controller = new CallsController(
    calls,
    bus,
    conference,
    userNames,
    contacts,
    userPhones,
    directory,
    permissions,
    bridge,
    presence,
    CONFIG,
  );
  return {
    controller,
    calls,
    conference,
    subject,
    userNames,
    contacts,
    userPhones,
    directory,
    permissions,
    bridge,
    presence,
  };
}

function makeRes() {
  const chunks: string[] = [];
  const closeHandlers: Array<() => void> = [];
  const res = {
    headers: {} as Record<string, string>,
    set: jest.fn(function (this: void, h: Record<string, string>) {
      Object.assign((res as any).headers, h);
    }),
    flushHeaders: jest.fn(),
    write: jest.fn((c: string) => {
      chunks.push(c);
      return true;
    }),
    on: jest.fn((event: string, cb: () => void) => {
      if (event === 'close') closeHandlers.push(cb);
    }),
    end: jest.fn(),
  };
  return { res, chunks, close: () => closeHandlers.forEach((cb) => cb()) };
}

describe('CallsController.list', () => {
  it('maps query params into the repository filter and clamps the limit', async () => {
    const { controller, calls } = makeController();
    const out = await controller.list(
      'cur1', '500', 'inbound', 'completed', 'agent-1', '404', '2026-08-01', '2026-08-05',
    );

    expect((calls.list as jest.Mock).mock.calls[0]).toEqual([
      {
        direction: 'inbound',
        status: 'completed',
        agentId: 'agent-1',
        number: '404',
        dateFrom: '2026-08-01',
        dateTo: '2026-08-05',
      },
      'cur1',
      100, // clamped from 500
    ]);
    expect(out).toMatchObject({
      success: true,
      pagination: { nextCursor: 'cur2', count: 1 },
    });
  });

  it('defaults the limit when absent or invalid', async () => {
    const { controller, calls } = makeController();
    await controller.list();
    expect((calls.list as jest.Mock).mock.calls[0][2]).toBe(25);
  });
});

describe('CallsController.detail', () => {
  it('404s for an unknown call', async () => {
    const { controller } = makeController({
      getBySid: jest.fn().mockResolvedValue(null),
    });
    await expect(controller.detail('CAnope')).rejects.toMatchObject({
      status: 404,
    });
  });
});

describe('CallsController.monitor', () => {
  it('grants and returns the conference name for a live call', async () => {
    const { controller, conference } = makeController({
      getBySid: jest.fn().mockResolvedValue(
        record({ status: 'in-progress', conferenceName: 'conf-CA1' }),
      ),
    });
    const out = await controller.monitor('CA1', { mode: 'listen' }, USER);
    expect(conference.grantMonitor).toHaveBeenCalledWith('sup-1', 'conf-CA1', 'listen');
    expect(out.data).toEqual({ conferenceName: 'conf-CA1' });
  });

  it('409s when the call is not live', async () => {
    const { controller } = makeController(); // status completed
    await expect(
      controller.monitor('CA1', { mode: 'listen' }, USER),
    ).rejects.toMatchObject({ status: 409 });
  });

  it('400s on a bogus mode', async () => {
    const { controller } = makeController();
    await expect(
      controller.monitor('CA1', { mode: 'spy' as never }, USER),
    ).rejects.toMatchObject({ status: 400 });
  });
});

describe('CallsController.stream (SSE)', () => {
  const flushMicrotasks = async () => {
    for (let i = 0; i < 5; i++) await Promise.resolve();
  };

  it('sets unbuffered SSE headers and frames name-enriched events', async () => {
    jest.useFakeTimers();
    const { controller, subject, userNames } = makeController();
    (userNames.resolve as jest.Mock).mockResolvedValue({});
    const { res, chunks, close } = makeRes();

    controller.stream(res as never);
    expect((res as any).headers).toMatchObject({
      'Content-Type': 'text/event-stream',
      'X-Accel-Buffering': 'no',
    });
    expect(chunks[0]).toBe(': connected\n\n');

    const event: CallEvent = { type: 'call.upserted', call: record() };
    subject.next(event);
    await flushMicrotasks(); // enrichment is async (cached name resolution)
    expect(chunks[1]).toBe(`data: ${JSON.stringify(event)}\n\n`);

    // heartbeat keeps proxies from timing the stream out
    jest.advanceTimersByTime(26_000);
    expect(chunks).toContain(': hb\n\n');

    // teardown on client close: no more writes after
    close();
    const count = chunks.length;
    subject.next(event);
    await flushMicrotasks();
    jest.advanceTimersByTime(30_000);
    expect(chunks.length).toBe(count);
    jest.useRealTimers();
  });

  it('events carry participant names and roles, matching the initial fetch', async () => {
    const { controller, subject, userNames } = makeController();
    (userNames.resolve as jest.Mock).mockResolvedValue({
      'u-1': { name: 'Nazarii', roleId: 'role-dispatcher' },
    });
    const { res, chunks } = makeRes();

    controller.stream(res as never);
    subject.next({
      type: 'call.upserted',
      call: record({
        agentId: 'u-1',
        participants: [{ userId: 'u-1', role: 'caller', at: 'now' }],
      }),
    });
    await flushMicrotasks();

    const frame = JSON.parse(chunks[1].replace(/^data: /, ''));
    expect(frame.call.agentName).toBe('Nazarii');
    expect(frame.call.agentRoleId).toBe('role-dispatcher');
    expect(frame.call.participants[0].name).toBe('Nazarii');
    expect(frame.call.participants[0].roleId).toBe('role-dispatcher');
  });

  it('events carry the client behind the number too', async () => {
    const { controller, subject, contacts } = makeController();
    (contacts.resolve as jest.Mock).mockResolvedValue({
      '+14045551234': { kind: 'contact', id: 'c1', name: 'Jane Roe' },
    });
    const { res, chunks } = makeRes();

    controller.stream(res as never);
    subject.next({
      type: 'call.upserted',
      call: record({ direction: 'inbound', from: '+14045551234', to: '+15412830739' }),
    });
    await flushMicrotasks();

    const frame = JSON.parse(chunks[1].replace(/^data: /, ''));
    expect(frame.call.fromParty).toEqual({
      kind: 'contact',
      id: 'c1',
      name: 'Jane Roe',
    });
    // Our own number isn't a client — nothing invented for the other side.
    expect(frame.call.toParty).toBeUndefined();
  });
});

describe('CallsController — naming the parties', () => {
  it('asks the CRM about both endpoints and attaches what comes back', async () => {
    const { controller, contacts } = makeController({
      list: jest.fn().mockResolvedValue({
        items: [
          {
            callSid: 'CA1',
            direction: 'outbound',
            from: '+15412830739',
            to: '+14045551234',
            startedAt: '2026-08-05T10:00:00.000Z',
            updatedAt: '2026-08-05T10:00:00.000Z',
          },
        ],
      }),
    });
    (contacts.resolve as jest.Mock).mockResolvedValue({
      '+14045551234': { kind: 'contact', id: 'c1', name: 'Jane Roe' },
    });

    const res = await controller.list();

    expect(contacts.resolve).toHaveBeenCalledWith([
      '+15412830739',
      '+14045551234',
    ]);
    expect(res.data[0].toParty).toEqual({
      kind: 'contact',
      id: 'c1',
      name: 'Jane Roe',
    });
    expect(res.data[0].fromParty).toBeUndefined();
  });

  it('attributes a number on a teammate profile to them, not to a client', async () => {
    const { controller, contacts, userPhones } = makeController({
      list: jest.fn().mockResolvedValue({
        items: [
          {
            callSid: 'CA1',
            direction: 'outbound',
            from: '+15412830739',
            to: '+14045551234',
            startedAt: '2026-08-05T10:00:00.000Z',
            updatedAt: '2026-08-05T10:00:00.000Z',
          },
        ],
      }),
    });
    // The same number is on a teammate's profile and on a stale contact.
    (userPhones.resolve as jest.Mock).mockResolvedValue({
      '+14045551234': { id: 'u9', name: 'Tamir Levi', roleId: 'role-technician' },
    });
    (contacts.resolve as jest.Mock).mockResolvedValue({
      '+14045551234': { kind: 'contact', id: 'c1', name: 'Jane Roe' },
    });

    const res = await controller.list();

    expect(res.data[0].toParty).toEqual({
      kind: 'user',
      id: 'u9',
      name: 'Tamir Levi',
      roleId: 'role-technician',
      personal: true,
    });
  });

  it('serves the log unnamed when the CRM is unreachable', async () => {
    const { controller, contacts } = makeController();
    (contacts.resolve as jest.Mock).mockResolvedValue({});

    const res = await controller.list();

    expect(res.success).toBe(true);
    expect(res.data[0].fromParty).toBeUndefined();
  });

  it('passes a comma-separated number list through as a filter', async () => {
    const { controller, calls } = makeController();

    await controller.list(
      undefined, undefined, undefined, undefined, undefined, undefined,
      undefined, undefined,
      '+14045551234, +15412830739',
    );

    expect(calls.list).toHaveBeenCalledWith(
      expect.objectContaining({ numbers: ['+14045551234', '+15412830739'] }),
      undefined,
      25,
    );
  });
});

describe('CallsController — transfer and add', () => {
  const liveCall = {
    callSid: 'CA1',
    status: 'in-progress',
    direction: 'inbound',
    from: '+14045551234',
    to: '+15412830739',
    startedAt: '2026-08-14T10:00:00.000Z',
    updatedAt: '2026-08-14T10:00:00.000Z',
  };

  it('adds a teammate and leaves the caller on the call', async () => {
    const { controller, conference, directory } = makeController({
      getBySid: jest.fn().mockResolvedValue(liveCall),
    });
    (directory.find as jest.Mock).mockResolvedValue({
      id: 'u9',
      name: 'Tamir Levi',
      phone: '+15550001111',
    });

    const res = await controller.addParticipant(
      'CA1',
      { userId: 'u9', channel: 'softphone' },
      { id: 'u1' } as never,
    );

    expect(conference.addParticipant).toHaveBeenCalledWith(
      'CA1',
      { userId: 'u9', channel: 'softphone', phone: '+15550001111' },
      'u1',
    );
    // Add is not a hand-over: the agent's leg is untouched.
    expect(conference.releaseAgentLeg).not.toHaveBeenCalled();
    expect(res.data.handOver).toBe(false);
  });

  it('hands the conference lifecycle to whoever took the call', async () => {
    const { controller, conference } = makeController({
      getBySid: jest.fn().mockResolvedValue(record({ status: 'in-progress' })),
    });

    await controller.addParticipant(
      'CA1',
      { userId: 'u9', channel: 'softphone', handOver: true },
      USER,
    );

    // Released the old leg AND promoted the new one: releasing alone leaves
    // nobody whose hang-up ends the call, and the customer sits there.
    expect(conference.releaseAgentLeg).toHaveBeenCalledWith('CA1', 'sup-1');
    expect(conference.promoteLeg).toHaveBeenCalledWith('CA1', 'CAadded');
  });

  it('releases the transferring leg on a hand-over', async () => {
    const { controller, conference, directory } = makeController({
      getBySid: jest.fn().mockResolvedValue(liveCall),
    });
    (directory.find as jest.Mock).mockResolvedValue({ id: 'u9', name: 'Tamir' });

    await controller.addParticipant(
      'CA1',
      { userId: 'u9', channel: 'softphone', handOver: true },
      { id: 'u1' } as never,
    );

    // Without this the agent hanging up would end the call for everyone.
    expect(conference.releaseAgentLeg).toHaveBeenCalledWith('CA1', 'u1');
  });

  it('reaches a teammate on their personal number', async () => {
    const { controller, conference, directory } = makeController({
      getBySid: jest.fn().mockResolvedValue(liveCall),
    });
    (directory.find as jest.Mock).mockResolvedValue({
      id: 'u9',
      name: 'Tamir',
      phone: '+15550001111',
    });

    await controller.addParticipant(
      'CA1',
      { userId: 'u9', channel: 'personal' },
      { id: 'u1' } as never,
    );

    expect(conference.addParticipant).toHaveBeenCalledWith(
      'CA1',
      expect.objectContaining({ channel: 'personal', phone: '+15550001111' }),
      'u1',
    );
  });

  it('refuses a call that has already ended', async () => {
    const { controller } = makeController({
      getBySid: jest.fn().mockResolvedValue({ ...liveCall, status: 'completed' }),
    });

    await expect(
      controller.addParticipant(
        'CA1',
        { userId: 'u9', channel: 'softphone' },
        { id: 'u1' } as never,
      ),
    ).rejects.toMatchObject({ status: 409 });
  });

  it('refuses somebody who is not a teammate', async () => {
    const { controller, directory } = makeController({
      getBySid: jest.fn().mockResolvedValue(liveCall),
    });
    (directory.find as jest.Mock).mockResolvedValue(undefined);

    await expect(
      controller.addParticipant(
        'CA1',
        { userId: 'nope', channel: 'softphone' },
        { id: 'u1' } as never,
      ),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('rejects a channel that is neither softphone nor personal', async () => {
    const { controller } = makeController({
      getBySid: jest.fn().mockResolvedValue(liveCall),
    });

    await expect(
      controller.addParticipant(
        'CA1',
        { userId: 'u9', channel: 'carrier-pigeon' as never },
        { id: 'u1' } as never,
      ),
    ).rejects.toMatchObject({ status: 400 });
  });
});

describe('CallsController — correcting the party', () => {
  it('overwrites the frozen party and marks it manual', async () => {
    const call = {
      callSid: 'CA1',
      startedAt: '2026-08-14T10:00:00.000Z',
      updatedAt: '2026-08-14T10:00:00.000Z',
      fromPartyKind: 'contact',
      fromPartyId: 'c1',
    };
    const { controller, calls } = makeController({
      getBySid: jest.fn().mockResolvedValue(call),
    });

    await controller.setParty(
      'CA1',
      { side: 'from', kind: 'contact', id: 'c2' },
      { id: 'u1' } as never,
    );

    expect(calls.setPartiesManually).toHaveBeenCalledWith(
      'CA1',
      expect.objectContaining({ from: { kind: 'contact', id: 'c2' } }),
      call.startedAt,
    );
  });

  it('clears a side when kind is null', async () => {
    const { controller, calls } = makeController({
      getBySid: jest.fn().mockResolvedValue({
        callSid: 'CA1',
        startedAt: '2026-08-14T10:00:00.000Z',
        updatedAt: '2026-08-14T10:00:00.000Z',
        toPartyKind: 'contact',
        toPartyId: 'c1',
      }),
    });

    await controller.setParty(
      'CA1',
      { side: 'to', kind: null, id: '' },
      { id: 'u1' } as never,
    );

    expect(calls.setPartiesManually).toHaveBeenCalledWith(
      'CA1',
      expect.objectContaining({ to: undefined }),
      expect.any(String),
    );
  });
});

describe('CallsController.recording proxy', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('404s when the call has no recording', async () => {
    const { controller } = makeController(); // record without recordingSid
    const { res } = makeRes();
    await expect(controller.recording('CA1', res as never)).rejects.toMatchObject({
      status: 404,
    });
  });

  it('fetches from Twilio with basic auth and passes the content type through', async () => {
    const { controller } = makeController({
      getBySid: jest.fn().mockResolvedValue(record({ recordingSid: 'RE123' })),
    });
    const body = new ReadableStream({
      start(c) {
        c.enqueue(new Uint8Array([1]));
        c.close();
      },
    });
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      body,
      headers: new Headers({ 'content-type': 'audio/mpeg' }),
    } as never);

    const { res } = makeRes();
    (res as any).emit = jest.fn();
    (res as any).once = jest.fn();
    (res as any).removeListener = jest.fn();
    await controller.recording('CA1', res as never);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/Recordings/RE123.mp3');
    const auth = (init.headers as Record<string, string>).Authorization;
    expect(auth).toBe(
      `Basic ${Buffer.from(`${CONFIG.accountSid}:${CONFIG.authToken}`).toString('base64')}`,
    );
    expect((res as any).headers['Content-Type']).toBe('audio/mpeg');
  });

  it('502s when Twilio rejects the media fetch', async () => {
    const { controller } = makeController({
      getBySid: jest.fn().mockResolvedValue(record({ recordingSid: 'RE123' })),
    });
    jest.spyOn(global, 'fetch').mockResolvedValue({ ok: false, body: null } as never);
    const { res } = makeRes();
    await expect(controller.recording('CA1', res as never)).rejects.toMatchObject({
      status: 502,
    });
  });
});


describe('CallsController — taking a call into another tab', () => {
  const live = record({
    callSid: 'CA1',
    status: 'in-progress',
    conferenceName: 'conf-CA1',
    agentId: 'sup-1',
  });

  it('grants a join and reports which legs are currently theirs', async () => {
    const { controller, conference } = makeController({
      activeCallFor: jest.fn().mockResolvedValue(live),
      conference: { legsOf: jest.fn().mockResolvedValue(['CAold']) },
    });

    const res = await controller.take('CA1', USER);

    expect(res.data).toEqual({ conferenceName: 'conf-CA1', previousLegs: ['CAold'] });
    expect(conference.grantMonitor).toHaveBeenCalledWith('sup-1', 'conf-CA1', 'join');
  });

  it('refuses a call the caller is not on — no permission stands in for that', async () => {
    const { controller, conference } = makeController({
      activeCallFor: jest.fn().mockResolvedValue(record({ callSid: 'CAother' })),
    });

    await expect(controller.take('CA1', USER)).rejects.toThrow(/not on this call/i);
    expect(conference.grantMonitor).not.toHaveBeenCalled();
  });

  it('refuses when the caller is on no call at all', async () => {
    const { controller } = makeController({
      activeCallFor: jest.fn().mockResolvedValue(null),
    });
    await expect(controller.take('CA1', USER)).rejects.toThrow(/not on this call/i);
  });

  it('releases the old leg before removing it, then promotes the new one', async () => {
    const order: string[] = [];
    const { controller, conference } = makeController({
      activeCallFor: jest.fn().mockResolvedValue(live),
      conference: {
        // After the hand-over the user has both legs; the old one is dropped.
        legsOf: jest.fn().mockResolvedValue(['CAold', 'CAnew']),
        releaseLeg: jest.fn(async () => void order.push('release')),
        removeParticipant: jest.fn(async () => void order.push('remove')),
        promoteLeg: jest.fn(async () => void order.push('promote')),
      },
    });

    const res = await controller.takeComplete('CA1', { previousLegs: ['CAold'] }, USER);

    // Removing a leg that still owns the conference lifecycle would take the
    // customer down with it, so the release has to land first.
    expect(order).toEqual(['release', 'remove', 'promote']);
    expect(conference.releaseLeg).toHaveBeenCalledWith('CA1', 'CAold');
    expect(conference.removeParticipant).toHaveBeenCalledWith('CA1', 'CAold');
    // The surviving leg becomes the one whose hang-up ends the call.
    expect(conference.promoteLeg).toHaveBeenCalledWith('CA1', 'CAnew');
    expect(res.data).toEqual({ sid: 'CA1', movedTo: ['CAnew'] });
  });

  it('refuses to drop the old leg when the new one never joined', async () => {
    const { controller, conference } = makeController({
      activeCallFor: jest.fn().mockResolvedValue(live),
      // The join was refused, so the only leg on the call is still the old one.
      conference: { legsOf: jest.fn().mockResolvedValue(['CAold']) },
    });

    await expect(
      controller.takeComplete('CA1', { previousLegs: ['CAold'] }, USER),
    ).rejects.toThrow(/did not move/i);

    // Nothing touched: removing CAold would have left the customer alone.
    expect(conference.releaseLeg).not.toHaveBeenCalled();
    expect(conference.removeParticipant).not.toHaveBeenCalled();
  });

  it('waits for a leg that is slow to appear rather than refusing', async () => {
    const legsOf = jest
      .fn()
      .mockResolvedValueOnce(['CAold'])
      .mockResolvedValue(['CAold', 'CAnew']);
    const { controller, conference } = makeController({
      activeCallFor: jest.fn().mockResolvedValue(live),
      conference: { legsOf },
    });

    const res = await controller.takeComplete('CA1', { previousLegs: ['CAold'] }, USER);

    expect(res.data).toEqual({ sid: 'CA1', movedTo: ['CAnew'] });
    expect(conference.removeParticipant).toHaveBeenCalledWith('CA1', 'CAold');
  });

  it('never promotes a leg it was told to drop', async () => {
    const { controller, conference } = makeController({
      activeCallFor: jest.fn().mockResolvedValue(live),
      conference: { legsOf: jest.fn().mockResolvedValue(['CAold', 'CAnew']) },
    });

    await controller.takeComplete('CA1', { previousLegs: ['CAold'] }, USER);

    expect(conference.promoteLeg).toHaveBeenCalledTimes(1);
    expect(conference.promoteLeg).toHaveBeenCalledWith('CA1', 'CAnew');
  });
});

/**
 * Call masking on the read paths. The grant lives on `contacts`, not `calls`,
 * so these routes cannot express it as a decorator — three of them
 * (`active`, `recent`, `stream`) are reachable by a technician who holds no
 * `calls` permission at all, which is exactly who must not see the numbers.
 */
describe('CallsController — masking client numbers', () => {
  const masked = () => ({
    permissions: { maySeeClientNumbers: jest.fn().mockResolvedValue(false) },
  });

  const withNumbers = (over: Partial<CallRecord> = {}) =>
    record({ from: '+14045550100', to: '+14045551234', ...over });

  it('drops both numbers from the global log', async () => {
    const { controller } = makeController({
      ...masked(),
      list: jest.fn().mockResolvedValue({ items: [withNumbers()] }),
    });

    const res = await controller.list();

    expect(res.data[0].from).toBeUndefined();
    expect(res.data[0].to).toBeUndefined();
    expect(res.data[0].fromMasked).toBe(true);
    expect(res.data[0].toMasked).toBe(true);
  });

  it('keeps the numbers for a granted viewer', async () => {
    const { controller } = makeController({
      list: jest.fn().mockResolvedValue({ items: [withNumbers()] }),
    });

    const res = await controller.list();

    expect(res.data[0].to).toBe('+14045551234');
  });

  it('masks the call you are currently on', async () => {
    const { controller } = makeController({
      ...masked(),
      activeCallFor: jest.fn().mockResolvedValue(withNumbers()),
    });

    const res = await controller.active(USER);

    expect(res.data?.to).toBeUndefined();
    expect(res.data?.toMasked).toBe(true);
  });

  /**
   * Previously this route returned RAW records straight from the GSI — no
   * enrichment and no redaction — on a handler documented as "any
   * authenticated user". It is the read path behind a technician's own history.
   */
  it('masks and enriches the current agent history', async () => {
    const { controller } = makeController({
      ...masked(),
      listByAgent: jest.fn().mockResolvedValue([withNumbers()]),
    });

    const res = await controller.recent(USER);

    expect(res.data[0].to).toBeUndefined();
    expect(res.data[0].toMasked).toBe(true);
  });

  it('masks a single call detail', async () => {
    const { controller } = makeController({
      ...masked(),
      getBySid: jest.fn().mockResolvedValue(withNumbers()),
    });

    const res = await controller.detail('CA1');

    expect(res.data?.from).toBeUndefined();
  });

  it('masks the live list', async () => {
    const { controller } = makeController({
      ...masked(),
      listLive: jest.fn().mockResolvedValue([withNumbers({ status: 'in-progress' })]),
    });

    const res = await controller.live();

    expect(res.data[0].to).toBeUndefined();
  });

  it('masks events on the SSE stream', async () => {
    const { controller, subject } = makeController(masked());
    const { res, chunks } = makeRes();
    controller.stream(res as never);

    subject.next({ type: 'call.upserted', call: withNumbers() } as CallEvent);
    await new Promise((r) => setImmediate(r));

    const frame = chunks.find((c) => c.startsWith('data:'))!;
    const payload = JSON.parse(frame.replace('data: ', ''));
    expect(payload.call.to).toBeUndefined();
    expect(payload.call.toMasked).toBe(true);
  });

  it('masks the stream when the permission lookup itself fails', async () => {
    // Falling through to the unmasked event on a Redis blip would defeat the
    // whole feature at exactly the moment nobody is watching.
    const { controller, subject } = makeController({
      permissions: {
        maySeeClientNumbers: jest.fn().mockRejectedValue(new Error('down')),
      },
    });
    const { res, chunks } = makeRes();
    controller.stream(res as never);

    subject.next({ type: 'call.upserted', call: withNumbers() } as CallEvent);
    await new Promise((r) => setImmediate(r));

    const frame = chunks.find((c) => c.startsWith('data:'))!;
    expect(JSON.parse(frame.replace('data: ', '')).call.to).toBeUndefined();
  });

  it('still names the parties for a masked viewer', async () => {
    // The screen-pop and a readable log are built from the party, not the
    // number — stripping names would push technicians back to their own phones.
    const { controller, contacts } = makeController({
      ...masked(),
      list: jest.fn().mockResolvedValue({ items: [withNumbers()] }),
    });
    (contacts.resolve as jest.Mock).mockResolvedValue({
      '+14045551234': { kind: 'contact', id: 'c1', name: 'Maria Alvarez' },
    });

    const res = await controller.list();

    expect(res.data[0].toParty).toMatchObject({ name: 'Maria Alvarez' });
    expect(res.data[0].to).toBeUndefined();
  });
});

/**
 * Which end rings the technician.
 *
 * Presence is a good DEFAULT — somebody sitting at a browser wants the call in
 * the browser — but it is a bad rule: a technician with the app open on a
 * laptop in the van still wants the call on the phone in their hand. So the
 * caller may say, and presence only decides when they do not.
 */
describe('CallsController.startBridge — choosing which end rings', () => {
  const user = { id: 'tech-1', roleId: 'role-technician' } as never;
  const req = { dealId: 'deal-1', contactId: 'contact-1' };

  function make(over: Record<string, unknown> = {}) {
    const harness = makeController({
      bridge: {
        prepare: jest.fn().mockResolvedValue({
          bridgeId: 'b-1',
          clientName: 'Maria Alvarez',
        }),
      },
      presence: { listOnline: jest.fn().mockResolvedValue(['tech-1']) },
      ...over,
    });
    // The Twilio leg is created inside ringTechnician; stub it out so these
    // cases are about the decision, not about placing a real call.
    const rang: string[] = [];
    (harness.controller as never as Record<string, unknown>).ringTechnician =
      jest.fn(async (bridgeId: string) => {
        rang.push(bridgeId);
        return 'CAtech';
      });
    return { ...harness, rang };
  }

  it('rings the handset when asked to, even with the softphone online', async () => {
    const { controller, rang } = make();

    const res = await controller.startBridge({ ...req, via: 'cell' }, user);

    expect(res.data.mode).toBe('cell');
    expect(rang).toEqual(['b-1']);
  });

  it('takes the browser leg when asked to', async () => {
    const { controller, rang } = make({
      presence: { listOnline: jest.fn().mockResolvedValue([]) },
    });

    const res = await controller.startBridge({ ...req, via: 'softphone' }, user);

    expect(res.data.mode).toBe('softphone');
    expect(rang).toEqual([]);
  });

  it('still follows presence when the caller does not say', async () => {
    const { controller } = make();

    const res = await controller.startBridge(req, user);

    expect(res.data.mode).toBe('softphone');
  });

  it('rings the handset when nobody is at a browser', async () => {
    const { controller } = make({
      presence: { listOnline: jest.fn().mockResolvedValue([]) },
    });

    const res = await controller.startBridge(req, user);

    expect(res.data.mode).toBe('cell');
  });

  it('refuses a choice that is not one of the two', async () => {
    const { controller } = make();

    await expect(
      controller.startBridge({ ...req, via: 'carrier-pigeon' } as never, user),
    ).rejects.toThrow(BadRequestException);
  });
});
