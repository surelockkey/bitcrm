import { CallsService, statusRank } from '../../src/calls/calls.service';
import {
  CallsRepository,
  type CallRecord,
} from '../../src/calls/calls.repository';

/**
 * applyLifecycle is the single writer used by the conference orchestration.
 * Twilio webhooks can arrive out of order — a terminal status must never be
 * regressed to a live one, and the first terminal status wins.
 */
describe('CallsService.applyLifecycle — monotonic status', () => {
  function make(existing: CallRecord | null) {
    const upserts: CallRecord[] = [];
    const repo = {
      getBySid: jest.fn().mockResolvedValue(existing),
      upsert: jest.fn().mockImplementation(async (r: CallRecord) => {
        upserts.push(r);
      }),
    } as unknown as CallsRepository;
    return { service: new CallsService(repo), upserts };
  }

  const base: CallRecord = {
    callSid: 'CA1',
    status: 'in-progress',
    direction: 'outbound',
    startedAt: '2026-08-05T10:00:00.000Z',
    updatedAt: '2026-08-05T10:00:00.000Z',
    answeredAt: '2026-08-05T10:00:05.000Z',
  };

  it('ranks statuses live < terminal', () => {
    expect(statusRank('queued')).toBeLessThan(statusRank('ringing'));
    expect(statusRank('ringing')).toBeLessThan(statusRank('in-progress'));
    expect(statusRank('in-progress')).toBeLessThan(statusRank('completed'));
    expect(statusRank('completed')).toBe(statusRank('busy'));
  });

  it('applies a forward transition', async () => {
    const { service, upserts } = make({ ...base, status: 'ringing' });
    await service.applyLifecycle({ callSid: 'CA1', status: 'in-progress' });
    expect(upserts[0].status).toBe('in-progress');
  });

  it('drops a late "ringing" after completion but keeps other fields', async () => {
    const { service, upserts } = make({ ...base, status: 'completed' });
    await service.applyLifecycle({
      callSid: 'CA1',
      status: 'ringing',
      recordingSid: 'RE1',
    });
    expect(upserts[0].status).toBeUndefined(); // not regressed
    expect(upserts[0].recordingSid).toBe('RE1'); // still recorded
  });

  it('first terminal status wins (busy is not overwritten by completed)', async () => {
    const { service, upserts } = make({ ...base, status: 'busy' });
    await service.applyLifecycle({ callSid: 'CA1', status: 'completed' });
    expect(upserts[0].status).toBeUndefined();
  });

  it('computes talk time from answeredAt when the call ends', async () => {
    const { service, upserts } = make(base);
    await service.applyLifecycle({
      callSid: 'CA1',
      status: 'completed',
      endedAt: '2026-08-05T10:02:05.000Z',
    });
    expect(upserts[0].durationSeconds).toBe(120);
  });

  it('creates the record when none exists yet', async () => {
    const { service, upserts } = make(null);
    await service.applyLifecycle({
      callSid: 'CAnew',
      status: 'initiated',
      direction: 'outbound',
      startedAt: '2026-08-05T10:00:00.000Z',
    });
    expect(upserts[0]).toMatchObject({ callSid: 'CAnew', status: 'initiated' });
  });
});

describe('CallsService — hidden internal legs never reach the live stream', () => {
  it('suppresses bus events for records with internalLegOf', async () => {
    const publish = jest.fn();
    const repo = {
      getBySid: jest.fn().mockResolvedValue(null),
      upsert: jest.fn().mockResolvedValue(undefined),
    } as unknown as CallsRepository;
    const service = new CallsService(repo, { publish } as never);

    await service.applyLifecycle({
      callSid: 'CAhidden',
      status: 'ringing',
      internalLegOf: 'CAvisible',
      startedAt: '2026-08-05T10:00:00.000Z',
    });
    expect(publish).not.toHaveBeenCalled();

    await service.applyLifecycle({
      callSid: 'CAvisible',
      status: 'ringing',
      startedAt: '2026-08-05T10:00:00.000Z',
    });
    expect(publish).toHaveBeenCalledTimes(1);
  });
});

describe('CallsService.recordStatus — legacy no-conference path', () => {
  function conferenceManaged(over: Partial<CallRecord> = {}) {
    const upserts: CallRecord[] = [];
    const repo = {
      getBySid: jest.fn().mockResolvedValue({
        callSid: 'CAconf',
        conferenceName: 'conf-CAconf',
        status: 'initiated',
        from: '+12624061115',
        to: '+380958601427',
        startedAt: '2026-08-05T10:00:00.000Z',
        updatedAt: '2026-08-05T10:00:00.000Z',
        ...over,
      } satisfies CallRecord),
      upsert: jest.fn().mockImplementation(async (r: CallRecord) => {
        upserts.push(r);
      }),
    } as unknown as CallsRepository;
    return { service: new CallsService(repo), upserts };
  }

  const sdkLegCallback = {
    CallSid: 'CAconf',
    CallStatus: 'completed',
    From: 'client:agent-1',
    To: '',
    Direction: 'inbound', // Twilio reports SDK legs as inbound
  };

  it('never overwrites a conference-managed record with what an SDK leg reports', async () => {
    const { service, upserts } = conferenceManaged();

    await service.recordStatus(sdkLegCallback);

    // Whatever else happens, the lying fields must not land.
    for (const u of upserts) {
      expect(u.from).not.toBe('client:agent-1');
      expect(u.to).not.toBe('');
      expect(u.direction).not.toBe('inbound');
    }
  });

  /**
   * The bug this exists for: hang up fast enough and the browser leg dies
   * before it ever joins its conference — so no conference is created, no
   * conference-end fires, and the ONLY word that the call is over is this
   * callback. Dropping it left the record live for the ten minutes the stale
   * sweep allows, and `activeCallFor` refused to place another call that whole
   * time: one quick hang-up cost the technician their phone.
   */
  it('finalises a conference leg that died before its conference existed', async () => {
    const { service, upserts } = conferenceManaged();

    await service.recordStatus(sdkLegCallback);

    expect(upserts).toHaveLength(1);
    expect(upserts[0]).toMatchObject({ callSid: 'CAconf', status: 'canceled' });
    expect(upserts[0].endedAt).toBeTruthy();
  });

  /** Nobody spoke, so it is not a completed call — same rule the conference-end
   *  handler applies, so both routes agree on what happened. */
  it('keeps a more specific failure over the generic hang-up', async () => {
    const { service, upserts } = conferenceManaged();

    await service.recordStatus({ ...sdkLegCallback, CallStatus: 'busy' });

    expect(upserts[0]).toMatchObject({ status: 'busy' });
  });

  /**
   * Once the client has answered, the conference exists and its own end event
   * is the authority — it completes the child legs and finalises with the
   * duration. Racing it from here would only risk a worse answer.
   */
  it('leaves an answered call to the conference-end handler', async () => {
    const { service, upserts } = conferenceManaged({
      answeredAt: '2026-08-05T10:00:05.000Z',
      status: 'in-progress',
    });

    await service.recordStatus(sdkLegCallback);

    expect(upserts).toHaveLength(0);
  });

  it('ignores a non-terminal report about a conference call', async () => {
    const { service, upserts } = conferenceManaged();

    await service.recordStatus({ ...sdkLegCallback, CallStatus: 'ringing' });

    expect(upserts).toHaveLength(0);
  });

  it('still persists plain status callbacks (in-flight old-style calls)', async () => {
    const upserts: CallRecord[] = [];
    const repo = {
      getBySid: jest.fn().mockResolvedValue(null),
      upsert: jest.fn().mockImplementation(async (r: CallRecord) => {
        upserts.push(r);
      }),
    } as unknown as CallsRepository;
    const service = new CallsService(repo);

    await service.recordStatus(
      {
        CallSid: 'CAlegacy',
        CallStatus: 'completed',
        From: 'client:agent-1',
        To: '+14045551234',
        Direction: 'outbound-dial',
        CallDuration: '42',
      },
      '2026-08-05T00:00:00.000Z',
    );
    expect(upserts[0]).toMatchObject({
      callSid: 'CAlegacy',
      status: 'completed',
      direction: 'outbound',
      agentId: 'agent-1',
      durationSeconds: 42,
    });
  });
});
