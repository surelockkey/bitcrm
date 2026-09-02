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
    phones?: { phones: string[]; name?: string } | null;
    callerId?: { callerId?: string; source?: string };
    activeCall?: unknown;
  } = {},
) {
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
  const service = new BridgeService(
    redis as never,
    deals as never,
    contacts as never,
    callerIds as never,
    calls as never,
  );
  return { service, redis, deals, contacts, callerIds, calls };
}

describe('BridgeService.mayReachDeal', () => {
  it('admits a technician on the job roster', () => {
    const { service } = makeService();
    expect(service.mayReachDeal(TECH, DEAL)).toBe(true);
  });

  it('admits the job dispatcher', () => {
    const { service } = makeService();
    expect(service.mayReachDeal(DISPATCHER, DEAL)).toBe(true);
  });

  it('refuses a technician who is not on the roster', () => {
    const { service } = makeService();
    expect(service.mayReachDeal(OUTSIDER, DEAL)).toBe(false);
  });

  it('admits anyone who is not a technician — dispatch calls whoever they need', () => {
    const { service } = makeService();
    const manager = user('mgr-1', 'role-dept-manager');
    expect(service.mayReachDeal(manager, DEAL)).toBe(true);
  });

  it('refuses a technician on a job with an empty roster', () => {
    const { service } = makeService();
    expect(service.mayReachDeal(TECH, { ...DEAL, assignedTechIds: [] })).toBe(false);
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

  it('stamps the market caller id on the context', async () => {
    const { service, redis } = makeService();

    const out = await service.prepare(TECH, { dealId: 'deal-1', contactId: 'contact-1' });

    const ctx = redis.hashes.get(`telephony:bridge:${out.bridgeId}`)!;
    expect(ctx.from).toBe('+14045550100');
    expect(ctx.callerIdSource).toBe('area');
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
