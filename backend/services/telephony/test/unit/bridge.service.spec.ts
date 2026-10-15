import { ForbiddenException, ConflictException, BadRequestException, NotFoundException } from '@nestjs/common';
import { BridgeService } from '../../src/common/bridge.service';
import { type DealForCall } from '../../src/common/deal-read.service';

const DEAL: DealForCall = {
  id: 'deal-1',
  dealNumber: 'K4T9ZW',
  contactId: 'contact-1',
  serviceAreaId: 'area-atl',
  assignedTechIds: ['tech-1', 'tech-2'],
  assignedDispatcherId: 'disp-1',
  superStatus: 'in_progress',
};

const user = (id: string, roleId: string) =>
  ({ id, cognitoSub: `sub-${id}`, email: `${id}@x.com`, roleId, department: 'field' });

const TECH = user('tech-1', 'role-technician');
const OUTSIDER = user('tech-9', 'role-technician');
const DISPATCHER = user('disp-1', 'role-dispatcher');

/** A minimal in-memory stand-in for the two Redis idioms the bridge uses. */
function fakeRedis() {
  const strings = new Map<string, string>();
  const hashes = new Map<string, Record<string, string>>();
  return {
    strings,
    hashes,
    client: {
      set: jest.fn(async (k: string, v: string, ..._rest: unknown[]) => {
        const nx = _rest.includes('NX');
        if (nx && strings.has(k)) return null;
        strings.set(k, v);
        return 'OK';
      }),
      get: jest.fn(async (k: string) => strings.get(k) ?? null),
      del: jest.fn(async (...ks: string[]) => {
        ks.forEach((k) => {
          strings.delete(k);
          hashes.delete(k);
        });
        return ks.length;
      }),
      hset: jest.fn(async (k: string, v: Record<string, string>) => {
        hashes.set(k, { ...(hashes.get(k) ?? {}), ...v });
        return 1;
      }),
      hgetall: jest.fn(async (k: string) => hashes.get(k) ?? {}),
      expire: jest.fn(async () => 1),
    },
  };
}

function makeService(
  over: {
    deal?: DealForCall | null;
    phones?: {
      phones: string[];
      name?: string;
      extensions?: Record<string, string>;
    } | null;
    callerId?: { callerId?: string; source?: string };
    activeCall?: unknown;
    /** What the client's call/SMS history answers; an Error makes it fail. */
    history?: string[] | Error;
    /** Whether the caller's deals are scoped `assigned_only`. */
    assignedOnly?: boolean;
  } = {},
) {
  const permissions = {
    isAssignedOnly: jest.fn(async () => over.assignedOnly ?? false),
  };
  const redis = fakeRedis();
  const deals = {
    find: jest.fn().mockResolvedValue(
      over.deal === undefined ? DEAL : over.deal,
    ),
  };
  const contacts = {
    phonesOf: jest.fn().mockResolvedValue(
      over.phones === undefined
        ? { phones: ['+14045551234', '+14045555678'], name: 'Maria Alvarez' }
        : over.phones,
    ),
  };
  const callerIds = {
    forServerLeg: jest
      .fn()
      .mockResolvedValue(over.callerId ?? { callerId: '+14045550100', source: 'area' }),
  };
  const calls = {
    activeCallFor: jest.fn().mockResolvedValue(over.activeCall ?? null),
  };
  const history = {
    numbersFor: jest.fn(async () => {
      if (over.history instanceof Error) throw over.history;
      return over.history ?? [];
    }),
  };
  const service = new BridgeService(
    redis as never,
    deals as never,
    contacts as never,
    callerIds as never,
    calls as never,
    history as never,
    permissions as never,
  );
  return { service, redis, deals, contacts, callerIds, calls, history, permissions };
}

describe('BridgeService.mayReachDeal', () => {
  it('admits a technician on the job roster', async () => {
    const { service } = makeService();
    await expect(service.mayReachDeal(TECH, DEAL)).resolves.toBe(true);
  });

  it('admits the job dispatcher', async () => {
    const { service } = makeService();
    await expect(service.mayReachDeal(DISPATCHER, DEAL)).resolves.toBe(true);
  });

  it('refuses a technician who is not on the roster', async () => {
    const { service } = makeService();
    await expect(service.mayReachDeal(OUTSIDER, DEAL)).resolves.toBe(false);
  });

  it('admits anyone who is not a technician — dispatch calls whoever they need', async () => {
    const { service } = makeService();
    const manager = user('mgr-1', 'role-dept-manager');
    await expect(service.mayReachDeal(manager, DEAL)).resolves.toBe(true);
  });

  it('refuses a technician on a job with an empty roster', async () => {
    const { service } = makeService();
    await expect(service.mayReachDeal(TECH, { ...DEAL, assignedTechIds: [] })).resolves.toBe(false);
  });

  /**
   * The role id alone missed a custom field role: anybody whose jobs are
   * scoped `assigned_only` sees only their own jobs everywhere else, and must
   * not reach the clients of the others through the phone. Only ever
   * TIGHTENS — the technician role is refused off-roster whatever its scope.
   */
  describe('aligned with the deals data scope', () => {
    const FIELD = user('field-1', 'role-custom-field');

    it('refuses an assigned_only user who is not on the job', async () => {
      const { service, permissions } = makeService({ assignedOnly: true });

      await expect(service.mayReachDeal(FIELD, DEAL)).resolves.toBe(false);
      expect(permissions.isAssignedOnly).toHaveBeenCalledWith(FIELD, 'deals');
    });

    it('admits an assigned_only user who is on the job', async () => {
      const { service } = makeService({ assignedOnly: true });

      await expect(
        service.mayReachDeal(FIELD, { ...DEAL, assignedTechIds: ['field-1'] }),
      ).resolves.toBe(true);
    });

    it('admits an assigned_only dispatcher on their own job', async () => {
      const { service } = makeService({ assignedOnly: true });

      await expect(service.mayReachDeal(DISPATCHER, DEAL)).resolves.toBe(true);
    });

    it('admits a user whose jobs are not scoped to their own', async () => {
      const { service } = makeService({ assignedOnly: false });

      await expect(service.mayReachDeal(FIELD, DEAL)).resolves.toBe(true);
    });

    it('never loosens the technician rule, whatever the scope says', async () => {
      const { service } = makeService({ assignedOnly: false });

      await expect(service.mayReachDeal(OUTSIDER, DEAL)).resolves.toBe(false);
    });

    it('asks nothing for somebody on the roster', async () => {
      const { service, permissions } = makeService({ assignedOnly: true });

      await service.mayReachDeal(TECH, DEAL);

      expect(permissions.isAssignedOnly).not.toHaveBeenCalled();
    });
  });
});

describe('BridgeService.prepare', () => {
  it('resolves the client number server-side and never returns it', async () => {
    const { service, contacts } = makeService();

    const out = await service.prepare(TECH, {
      dealId: 'deal-1',
      contactId: 'contact-1',
    });

    expect(contacts.phonesOf).toHaveBeenCalledWith('contact-1');
    expect(out.clientName).toBe('Maria Alvarez');
    expect(JSON.stringify(out)).not.toContain('+14045551234');
  });

  it('honours phoneIndex', async () => {
    const { service, redis } = makeService();

    const out = await service.prepare(TECH, {
      dealId: 'deal-1',
      contactId: 'contact-1',
      phoneIndex: 1,
    });

    const ctx = redis.hashes.get(`telephony:bridge:${out.bridgeId}`)!;
    expect(ctx.to).toBe('+14045555678');
  });

  it('dials the job’s own first number when it has one ("This job only")', async () => {
    const { service, redis } = makeService({ deal: { ...DEAL, clientPhone: '+12035550123' } });

    const first = await service.prepare(TECH, { dealId: 'deal-1', contactId: 'contact-1' });
    const second = await service.prepare(
      { ...TECH, id: 'tech-2' },
      { dealId: 'deal-1', contactId: 'contact-1', phoneIndex: 1 },
    );

    expect(redis.hashes.get(`telephony:bridge:${first.bridgeId}`)!.to).toBe('+12035550123');
    // The other numbers are the client's own, as before.
    expect(redis.hashes.get(`telephony:bridge:${second.bridgeId}`)!.to).toBe('+14045555678');
  });

  /**
   * The client's extension rides on the context, so the conference can press
   * it once the client answers — never in the browser's hands.
   */
  it('stashes the extension of the number being rung', async () => {
    const { service, redis } = makeService({
      phones: {
        phones: ['+14045551234', '+14045555678'],
        name: 'Maria Alvarez',
        extensions: { '+14045555678': '102' },
      },
    });

    const out = await service.prepare(TECH, {
      dealId: 'deal-1',
      contactId: 'contact-1',
      phoneIndex: 1,
    });

    const ctx = redis.hashes.get(`telephony:bridge:${out.bridgeId}`)!;
    expect(ctx.extension).toBe('102');
    expect(JSON.stringify(out)).not.toContain('102');
  });

  it('stashes no extension for a number without one', async () => {
    const { service, redis } = makeService();

    const out = await service.prepare(TECH, { dealId: 'deal-1', contactId: 'contact-1' });

    expect(redis.hashes.get(`telephony:bridge:${out.bridgeId}`)!).not.toHaveProperty('extension');
  });

  it('stamps the market caller id on the context', async () => {
    const { service, redis } = makeService();

    const out = await service.prepare(TECH, { dealId: 'deal-1', contactId: 'contact-1' });

    const ctx = redis.hashes.get(`telephony:bridge:${out.bridgeId}`)!;
    expect(ctx.from).toBe('+14045550100');
    expect(ctx.callerIdSource).toBe('area');
  });

  /**
   * 2026-10-15, variant 2 of the masked call: the client is rung "from the
   * number the client has been talking to". The bridge hands the client's
   * history to the resolver, which keeps the first number we still own.
   */
  it('shows the client the company number they have been talking to', async () => {
    const { service, redis, history, callerIds } = makeService({
      history: ['+15555550000', '+14045550100'],
      callerId: { callerId: '+15555550000', source: 'recent' },
    });

    const out = await service.prepare(TECH, { dealId: 'deal-1', contactId: 'contact-1' });

    expect(history.numbersFor).toHaveBeenCalledWith('contact-1');
    expect(callerIds.forServerLeg).toHaveBeenCalledWith(DEAL, ['+15555550000', '+14045550100']);
    const ctx = redis.hashes.get(`telephony:bridge:${out.bridgeId}`)!;
    expect(ctx.from).toBe('+15555550000');
    expect(ctx.callerIdSource).toBe('recent');
  });

  it('a history that cannot be read never costs the call — the market chain, as before', async () => {
    const { service, callerIds } = makeService({ history: new Error('dynamo down') });

    const out = await service.prepare(TECH, { dealId: 'deal-1', contactId: 'contact-1' });

    expect(out.bridgeId).toBeDefined();
    expect(callerIds.forServerLeg).toHaveBeenCalledWith(DEAL, []);
  });

  it('refuses a technician who is not on the job', async () => {
    const { service } = makeService();

    await expect(
      service.prepare(OUTSIDER, { dealId: 'deal-1', contactId: 'contact-1' }),
    ).rejects.toThrow(ForbiddenException);
  });

  /** A contactId that is not this job's client is somebody else's client. */
  it('refuses a contact that does not belong to the job', async () => {
    const { service } = makeService();

    await expect(
      service.prepare(TECH, { dealId: 'deal-1', contactId: 'contact-other' }),
    ).rejects.toThrow(BadRequestException);
  });

  it('404s an unknown job', async () => {
    const { service } = makeService({ deal: null });

    await expect(
      service.prepare(TECH, { dealId: 'nope', contactId: 'contact-1' }),
    ).rejects.toThrow(NotFoundException);
  });

  it('refuses when the client has no number on file', async () => {
    const { service } = makeService({ phones: { phones: [] } });

    await expect(
      service.prepare(TECH, { dealId: 'deal-1', contactId: 'contact-1' }),
    ).rejects.toThrow(BadRequestException);
  });

  it('refuses a phoneIndex past the end of the list', async () => {
    const { service } = makeService();

    await expect(
      service.prepare(TECH, { dealId: 'deal-1', contactId: 'contact-1', phoneIndex: 7 }),
    ).rejects.toThrow(BadRequestException);
  });

  /**
   * A double-tap on a mobile is one gesture, and each tap would otherwise
   * place a real PSTN call. The NX key is the only thing doing this work —
   * activeCallFor cannot, because on the cell path nothing has written a
   * participant yet when the second tap lands.
   */
  it('refuses a second in-flight bridge for the same user', async () => {
    const { service } = makeService();
    await service.prepare(TECH, { dealId: 'deal-1', contactId: 'contact-1' });

    await expect(
      service.prepare(TECH, { dealId: 'deal-1', contactId: 'contact-1' }),
    ).rejects.toThrow(ConflictException);
  });

  it('refuses when the user is already on a call', async () => {
    const { service } = makeService({ activeCall: { callSid: 'CA9' } });

    await expect(
      service.prepare(TECH, { dealId: 'deal-1', contactId: 'contact-1' }),
    ).rejects.toThrow(ConflictException);
  });

  it('releases the per-user claim so the next call can start', async () => {
    const { service } = makeService();
    const first = await service.prepare(TECH, { dealId: 'deal-1', contactId: 'contact-1' });

    await service.release(TECH.id, first.bridgeId);

    await expect(
      service.prepare(TECH, { dealId: 'deal-1', contactId: 'contact-1' }),
    ).resolves.toBeTruthy();
  });
});

describe('BridgeService.context', () => {
  it('reads a stashed context back', async () => {
    const { service } = makeService();
    const { bridgeId } = await service.prepare(TECH, {
      dealId: 'deal-1',
      contactId: 'contact-1',
    });

    const ctx = await service.context(bridgeId);

    expect(ctx).toMatchObject({
      technicianId: 'tech-1',
      to: '+14045551234',
      from: '+14045550100',
      dealId: 'deal-1',
      contactId: 'contact-1',
      clientName: 'Maria Alvarez',
    });
  });

  it('returns null for an unknown or expired bridge', async () => {
    const { service } = makeService();
    await expect(service.context('nope')).resolves.toBeNull();
  });
});

/**
 * The bridge's progress, which the phone polls after "Call client". It lives
 * beside the context, not in it: the context (with the client's real number)
 * is deleted on every terminal leg status, and a `failed` that vanished with
 * it would leave the phone saying nothing — the bug this exists to fix.
 */
describe('BridgeService — progress', () => {
  const STATE_KEY = 'telephony:bridge:state:b-1';

  it('opens at "ringing your phone", owned by whoever started it, on the context TTL', async () => {
    const { service, redis } = makeService();

    await service.track('b-1', 'tech-1');

    expect(redis.hashes.get(STATE_KEY)).toEqual({ state: 'ringing_you', ownerId: 'tech-1' });
    expect(redis.client.expire).toHaveBeenCalledWith(STATE_KEY, 300);
    await expect(service.statusFor('b-1', 'tech-1')).resolves.toEqual({ state: 'ringing_you' });
  });

  // Progress is a courtesy to the polling phone, never a dependency of the
  // call: ringTechnician writes it around calls.create, and a Redis blip there
  // must not fail the POST — after calls.create that would release the bridge
  // while the technician's phone is already ringing.
  it('never fails the call over a progress write: track and rememberLeg swallow a Redis error', async () => {
    const { service, redis } = makeService();
    (redis.client.hset as jest.Mock).mockRejectedValueOnce(new Error('ECONNRESET'));
    await expect(service.track('b-1', 'tech-1')).resolves.toBeUndefined();

    (redis.client.hset as jest.Mock).mockRejectedValueOnce(new Error('ECONNRESET'));
    await expect(service.rememberLeg('b-1', 'CA-1')).resolves.toBeUndefined();
  });

  it('answers only the user who started the bridge', async () => {
    const { service } = makeService();
    await service.track('b-1', 'tech-1');

    await expect(service.statusFor('b-1', 'tech-2')).resolves.toBeNull();
  });

  it('answers nothing for an unknown or expired bridge', async () => {
    const { service } = makeService();

    await expect(service.statusFor('nope', 'tech-1')).resolves.toBeNull();
    await expect(service.statusFor('', 'tech-1')).resolves.toBeNull();
  });

  it('moves forward with the reason, and never back', async () => {
    const { service } = makeService();
    await service.track('b-1', 'tech-1');

    await service.advance('b-1', () => ({ state: 'connecting_client' }));
    await service.advance('b-1', () => ({ state: 'you_answered' })); // late
    expect(await service.statusFor('b-1', 'tech-1')).toEqual({ state: 'connecting_client' });

    await service.advance('b-1', () => ({ state: 'failed', reason: 'The client did not answer' }));
    await service.advance('b-1', () => ({ state: 'ended' }));
    expect(await service.statusFor('b-1', 'tech-1')).toEqual({
      state: 'failed',
      reason: 'The client did not answer',
    });
  });

  it('hands the step the stage it is at', async () => {
    const { service } = makeService();
    await service.track('b-1', 'tech-1');
    const step = jest.fn(() => null);

    await service.advance('b-1', step);

    expect(step).toHaveBeenCalledWith('ringing_you');
  });

  it('leaves a bridge nobody is tracking alone (a softphone bridge, an expired one)', async () => {
    const { service, redis } = makeService();

    await service.advance('b-untracked', () => ({ state: 'connected' }));

    expect(redis.hashes.has('telephony:bridge:state:b-untracked')).toBe(false);
  });

  it('outlives release — the outcome is read after the legs are over', async () => {
    const { service } = makeService();
    await service.track('b-1', 'tech-1');
    await service.advance('b-1', () => ({ state: 'failed', reason: 'Your phone did not answer' }));

    await service.release('tech-1', 'b-1');

    expect(await service.statusFor('b-1', 'tech-1')).toEqual({
      state: 'failed',
      reason: 'Your phone did not answer',
    });
  });

  it('remembers the technician’s ringing leg, so Cancel can hang it up', async () => {
    const { service } = makeService();
    await service.track('b-1', 'tech-1');

    await service.rememberLeg('b-1', 'CAtech');

    await expect(service.ringingLeg('b-1')).resolves.toBe('CAtech');
    await expect(service.ringingLeg('nope')).resolves.toBeNull();
    // Never part of what the phone is told.
    expect(await service.statusFor('b-1', 'tech-1')).toEqual({ state: 'ringing_you' });
  });
});
