import { DialInService } from '../../src/exts/dial-in.service';

const DEAL = {
  id: 'deal-1',
  dealNumber: 'K4T9ZW',
  contactId: 'contact-1',
  serviceAreaId: 'area-atl',
  assignedTechIds: ['tech-1', 'tech-2'],
};

function makeService(
  over: {
    ext?: unknown;
    deal?: unknown;
    /** Who the CALLER'S number belongs to, as the directory reports it. */
    callerIs?: { id: string; name: string } | null;
    phones?: {
      phones: string[];
      name?: string;
      extensions?: Record<string, string>;
    } | null;
    counters?: Record<string, number>;
  } = {},
) {
  const counters = over.counters ?? {};
  const redis = {
    client: {
      get: jest.fn(async (k: string) =>
        counters[k] === undefined ? null : String(counters[k]),
      ),
      incr: jest.fn(async (k: string) => {
        counters[k] = (counters[k] ?? 0) + 1;
        return counters[k];
      }),
      expire: jest.fn(async () => 1),
    },
  };
  const exts = {
    resolve: jest
      .fn()
      .mockResolvedValue(
        over.ext === undefined ? { code: '4729', dealId: 'deal-1' } : over.ext,
      ),
  };
  const deals = {
    find: jest.fn().mockResolvedValue(over.deal === undefined ? DEAL : over.deal),
  };
  const contacts = {
    phonesOf: jest
      .fn()
      .mockResolvedValue(
        over.phones === undefined
          ? { phones: ['+14045551234'], name: 'Maria Alvarez' }
          : over.phones,
      ),
  };
  const callerIds = {
    forServerLeg: jest
      .fn()
      .mockResolvedValue({ callerId: '+14045550100', source: 'area' }),
  };
  const bridge = { stash: jest.fn().mockResolvedValue('bridge-1') };
  const caller =
    over.callerIs === undefined ? { id: 'tech-1', name: 'Marco Diaz' } : over.callerIs;
  const userPhones = {
    resolve: jest.fn(async (phones: string[]) =>
      caller && phones[0] ? { [phones[0]]: caller } : {},
    ),
  };

  const service = new DialInService(
    exts as never,
    deals as never,
    contacts as never,
    callerIds as never,
    bridge as never,
    redis as never,
    userPhones as never,
  );

  return { service, exts, deals, contacts, bridge, counters, userPhones, callerIds };
}

describe('DialInService.resolve', () => {
  it('resolves a code to the job, the caller and the client', async () => {
    const { service } = makeService();

    const out = await service.resolve('4729', '+14045550134');

    expect(out).toMatchObject({
      dealId: 'deal-1',
      dealNumber: 'K4T9ZW',
      technicianId: 'tech-1',
      clientName: 'Maria Alvarez',
      to: '+14045551234',
      from: '+14045550100',
    });
  });

  /**
   * Pin (2026-10-15): only the masked call ("call me about this job") puts the
   * client's recent numbers ahead of the market. The dial-in keeps the
   * market chain — it hands the resolver no history.
   */
  it('keeps the market caller id chain — no client history', async () => {
    const { service, callerIds } = makeService();

    await service.resolve('4729', '+14045550134');

    expect(callerIds.forServerLeg).toHaveBeenCalledTimes(1);
    expect(callerIds.forServerLeg.mock.calls[0]).toEqual([DEAL]);
  });

  it('connects to the job’s own first number when it has one ("This job only")', async () => {
    const { service } = makeService({ deal: { ...DEAL, clientPhone: '+12035550123' } });

    const out = await service.resolve('4729', '+14045550134');

    expect(out).toMatchObject({ to: '+12035550123', clientName: 'Maria Alvarez' });
  });

  /**
   * The code says which job; it does not say who is calling. Their number
   * does, when we recognise it — that is what puts a name on the call log
   * instead of an unknown number.
   */
  it('names the caller from their own number when it is one of ours', async () => {
    const { service } = makeService();

    const out = await service.resolve('4729', '+14045550134');

    expect(out?.technicianId).toBe('tech-1');
  });

  /**
   * A borrowed phone, a hire-car handsfree, a withheld caller id — the whole
   * reason this line exists is a technician without their usual device. It
   * connects, and the call is simply recorded without a name on it.
   */
  it('still connects a caller nobody recognises', async () => {
    const { service } = makeService({ callerIs: null });

    const out = await service.resolve('4729', '+19995550000');

    expect(out).toMatchObject({ dealId: 'deal-1', to: '+14045551234' });
    expect(out?.technicianId).toBeUndefined();
  });

  /** A recognised caller who is not on this job is not the technician for it,
   *  so the call is not attributed to them — but the code still routes. */
  it('does not name a caller who is not on the job', async () => {
    const { service } = makeService({ callerIs: { id: 'someone-else', name: 'Dana' } });

    const out = await service.resolve('4729', '+14045550134');

    expect(out?.dealId).toBe('deal-1');
    expect(out?.technicianId).toBeUndefined();
  });

  /**
   * Every one of these refuses IDENTICALLY. The caller cannot tell them apart,
   * which is what stops the line becoming an oracle that maps live job codes.
   */
  it.each([
    ['an unknown code', { ext: null }],
    ['a job that no longer exists', { deal: null }],
    ['a closed job', { deal: { ...DEAL, closedAt: '2026-08-01T00:00:00.000Z' } }],
    ['a client with no number on file', { phones: { phones: [] } }],
  ])('refuses %s', async (_label, over) => {
    const { service } = makeService(over as never);

    await expect(
      service.resolve('4729', '+14045550134'),
    ).resolves.toBeNull();
  });

  /**
   * An outage is exactly when you cannot tell a current technician from a
   * removed one, so deal-service being unreachable REFUSES rather than
   * falling back to whatever the code was minted with.
   */
  it('refuses when the job cannot be re-read', async () => {
    const { service, deals } = makeService();
    deals.find.mockResolvedValue(null);

    await expect(
      service.resolve('4729', '+14045550134'),
    ).resolves.toBeNull();
  });

  /** Naming the caller is a nicety; the call must not fail without it. */
  it('connects even when the caller lookup is unavailable', async () => {
    const { service, userPhones } = makeService();
    userPhones.resolve.mockRejectedValue(new Error('user-service down'));

    const out = await service.resolve('4729', '+14045550134');

    expect(out).toMatchObject({ dealId: 'deal-1' });
    expect(out?.technicianId).toBeUndefined();
  });

  /** The job is re-read live, not trusted from when the code was minted: a
   *  code printed last week must not outlive the job it names. */
  it('re-reads the job on every call', async () => {
    const { service, deals } = makeService();

    await service.resolve('4729', '+14045550134');

    expect(deals.find).toHaveBeenCalledWith('deal-1');
  });
});

/**
 * Every client number on the job has its own code. The code names the number,
 * resolved in the same order the in-app call buttons use: position 0 is the
 * job's own first number when it has one, else the client's first; every
 * other position is the client's.
 */
describe('DialInService — the number a code names', () => {
  const TWO = {
    phones: ['+14045551234', '+14045555678'],
    name: 'Maria Alvarez',
    extensions: { '+14045555678': '102' },
  };

  it('rings the number the code was minted for', async () => {
    const { service } = makeService({
      ext: { code: '6100', dealId: 'deal-1', phoneIndex: 1 },
      phones: TWO,
    });

    const out = await service.resolve('6100', '+14045550134');

    expect(out).toMatchObject({ to: '+14045555678' });
  });

  it('reads a code with no position (minted before positions) as the first number', async () => {
    const { service } = makeService({ phones: TWO });

    const out = await service.resolve('4729', '+14045550134');

    expect(out).toMatchObject({ to: '+14045551234' });
  });

  it('never swaps the job’s own number in past the first position', async () => {
    const { service } = makeService({
      ext: { code: '6100', dealId: 'deal-1', phoneIndex: 1 },
      deal: { ...DEAL, clientPhone: '+12035550123' },
      phones: TWO,
    });

    const out = await service.resolve('6100', '+14045550134');

    expect(out?.to).toBe('+14045555678');
  });

  /** Carried to the conference, which presses it once the client answers. */
  it('carries the number’s extension', async () => {
    const { service } = makeService({
      ext: { code: '6100', dealId: 'deal-1', phoneIndex: 1 },
      phones: TWO,
    });

    const out = await service.resolve('6100', '+14045550134');

    expect(out?.extension).toBe('102');
  });

  /**
   * The number was removed after its code was printed. Refused exactly as an
   * unknown code is — the caller hears the ordinary "that did not work" and is
   * offered another try, never somebody else's number.
   */
  it('refuses a code whose number is no longer on the client', async () => {
    const { service } = makeService({
      ext: { code: '7300', dealId: 'deal-1', phoneIndex: 2 },
      phones: TWO,
    });

    await expect(service.resolve('7300', '+14045550134')).resolves.toBeNull();
  });
});

describe('DialInService — rate limits', () => {
  it('counts a failure against the calling number', async () => {
    const { service, counters } = makeService({ ext: null });

    await service.resolve('4729', '+14045550134');

    expect(counters['telephony:ext:fail:+14045550134']).toBe(1);
  });

  it('parks a number that has failed too often', async () => {
    const { service, exts } = makeService({
      counters: { 'telephony:ext:fail:+14045550134': 10 },
    });

    await expect(
      service.resolve('4729', '+14045550134'),
    ).resolves.toBeNull();
    // Refused before the code was even looked up.
    expect(exts.resolve).not.toHaveBeenCalled();
  });

  /**
   * Withheld and unrecognised callers share one tighter bucket — otherwise
   * hiding the caller id would buy unlimited attempts.
   */
  it('uses a tighter shared bucket for a withheld caller id', async () => {
    const { service, exts } = makeService({
      counters: { 'telephony:ext:fail:anon': 5 },
    });

    await expect(service.resolve('4729', '')).resolves.toBeNull();
    expect(exts.resolve).not.toHaveBeenCalled();
  });

  it('parks everybody when failures spike across all callers', async () => {
    const { service, exts } = makeService({
      counters: { 'telephony:ext:fail:global': 30 },
    });

    await expect(
      service.resolve('4729', '+14045559999'),
    ).resolves.toBeNull();
    expect(exts.resolve).not.toHaveBeenCalled();
  });

  it('does not count a SUCCESS against the caller', async () => {
    const { service, counters } = makeService();

    await service.resolve('4729', '+14045550134');

    expect(counters['telephony:ext:fail:+14045550134']).toBeUndefined();
  });

  it('keeps working when Redis is down', async () => {
    const { service } = makeService();
    const service2 = service as unknown as {
      redis: { client: { get: jest.Mock } };
    };
    service2.redis.client.get.mockRejectedValue(new Error('down'));

    await expect(
      service.resolve('4729', '+14045550134'),
    ).resolves.toMatchObject({ dealId: 'deal-1' });
  });
});
