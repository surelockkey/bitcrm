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
    ...over,
  } as unknown as CallsService;
  const bus = { stream: () => subject.asObservable() } as unknown as CallEventsBus;
  const conference = {
    grantMonitor: jest.fn().mockResolvedValue(undefined),
  } as unknown as ConferenceService;
  const userNames = {
    resolve: jest.fn().mockResolvedValue({}),
  } as unknown as import('../../src/common/user-names.service').UserNamesService;
  const contacts = {
    resolve: jest.fn().mockResolvedValue({}),
  } as unknown as import('../../src/common/contact-lookup.service').ContactLookupService;
  const controller = new CallsController(
    calls,
    bus,
    conference,
    userNames,
    contacts,
    CONFIG,
  );
  return { controller, calls, conference, subject, userNames, contacts };
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
      '+14045551234': { id: 'c1', name: 'Jane Roe' },
    });
    const { res, chunks } = makeRes();

    controller.stream(res as never);
    subject.next({
      type: 'call.upserted',
      call: record({ direction: 'inbound', from: '+14045551234', to: '+15412830739' }),
    });
    await flushMicrotasks();

    const frame = JSON.parse(chunks[1].replace(/^data: /, ''));
    expect(frame.call.fromContact).toEqual({ id: 'c1', name: 'Jane Roe' });
    // Our own number isn't a client — nothing invented for the other side.
    expect(frame.call.toContact).toBeUndefined();
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
      '+14045551234': { id: 'c1', name: 'Jane Roe' },
    });

    const res = await controller.list();

    expect(contacts.resolve).toHaveBeenCalledWith([
      '+15412830739',
      '+14045551234',
    ]);
    expect(res.data[0].toContact).toEqual({ id: 'c1', name: 'Jane Roe' });
    expect(res.data[0].fromContact).toBeUndefined();
  });

  it('serves the log unnamed when the CRM is unreachable', async () => {
    const { controller, contacts } = makeController();
    (contacts.resolve as jest.Mock).mockResolvedValue({});

    const res = await controller.list();

    expect(res.success).toBe(true);
    expect(res.data[0].fromContact).toBeUndefined();
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
