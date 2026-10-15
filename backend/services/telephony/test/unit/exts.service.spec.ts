import { ServiceUnavailableException } from '@nestjs/common';
import { ExtsService } from '../../src/exts/exts.service';
import { type CallExt } from '../../src/exts/exts.repository';

function makeService() {
  /** Codes anybody has ever held — released rows stay, exactly as in Dynamo. */
  const taken = new Map<string, CallExt>();
  /** The reverse pointers, one per (job, phone position). */
  const byDeal = new Map<string, string>();
  const pointer = (dealId: string, phoneIndex = 0) => `${dealId}#${phoneIndex}`;

  const repo = {
    findByCode: jest.fn(async (code: string) => taken.get(code) ?? null),
    findByDeal: jest.fn(async (dealId: string, phoneIndex = 0) => {
      const code = byDeal.get(pointer(dealId, phoneIndex));
      return code ? (taken.get(code) ?? null) : null;
    }),
    listByDeal: jest.fn(async (dealId: string) =>
      [...byDeal.entries()]
        .filter(([key]) => key.startsWith(`${dealId}#`))
        .map(([, code]) => taken.get(code))
        .filter((ext): ext is CallExt => !!ext),
    ),
    claim: jest.fn(async (code: string, dealId: string, phoneIndex = 0) => {
      if (taken.has(code)) return null;
      const ext: CallExt = {
        code,
        dealId,
        phoneIndex,
        status: 'active',
        createdAt: '2026-08-26T10:00:00.000Z',
      };
      taken.set(code, ext);
      byDeal.set(pointer(dealId, phoneIndex), code);
      return ext;
    }),
    release: jest.fn(async (code: string) => {
      const ext = taken.get(code);
      if (ext) taken.set(code, { ...ext, status: 'released' });
    }),
  };
  return { service: new ExtsService(repo as never), repo, taken, byDeal };
}

describe('ExtsService — minting', () => {
  it('mints a four-digit code with no leading zero', async () => {
    const { service } = makeService();

    const ext = await service.forDeal('deal-1');

    expect(ext.code).toMatch(/^[1-9]\d{3}$/);
  });

  /**
   * A code minted at an older length can never be keyed in again: the dial-in
   * gathers exactly CALL_FLOW_LIMITS.extDigits digits and stops. So a job
   * holding one is re-minted the next time anybody looks at it, rather than
   * showing a number that silently cannot work.
   */
  it('replaces a code left over from a different code length', async () => {
    const { service, repo, taken } = makeService();
    taken.set('472913', {
      code: '472913',
      dealId: 'deal-1',
      status: 'active',
      createdAt: '2026-06-01T10:00:00.000Z',
    });
    (repo.findByDeal as jest.Mock).mockImplementationOnce(
      async () => taken.get('472913') ?? null,
    );

    const ext = await service.forDeal('deal-1');

    expect(ext.code).toMatch(/^[1-9]\d{3}$/);
    expect(repo.release).toHaveBeenCalledWith('472913');
  });

  /** A job screen re-render must not burn a code — a printed one has to work. */
  it('returns the same code for the same job', async () => {
    const { service } = makeService();

    const first = await service.forDeal('deal-1');
    const second = await service.forDeal('deal-1');

    expect(second.code).toBe(first.code);
  });

  it('gives different jobs different codes', async () => {
    const { service } = makeService();

    const a = await service.forDeal('deal-1');
    const b = await service.forDeal('deal-2');

    expect(a.code).not.toBe(b.code);
  });

  it('redraws when a code is already taken', async () => {
    const { service, repo } = makeService();
    let calls = 0;
    const realClaim = repo.claim;
    repo.claim = jest.fn(async (code: string, dealId: string) => {
      calls += 1;
      // First two draws collide, the third takes.
      if (calls < 3) return null;
      return realClaim(code, dealId);
    }) as never;

    const ext = await service.forDeal('deal-1');

    expect(ext.code).toMatch(/^[1-9]\d{3}$/);
    expect(calls).toBe(3);
  });

  /**
   * Loudly, with a real message: silently returning nothing would leave the
   * job screen showing a dial card that cannot work.
   */
  it('fails loudly when the space is too crowded to draw', async () => {
    const { service, repo } = makeService();
    repo.claim = jest.fn(async () => null) as never;

    await expect(service.forDeal('deal-1')).rejects.toThrow(
      ServiceUnavailableException,
    );
  });
});

describe('ExtsService — resolving', () => {
  it('resolves an active code to its job', async () => {
    const { service } = makeService();
    const ext = await service.forDeal('deal-1');

    await expect(service.resolve(ext.code)).resolves.toMatchObject({
      dealId: 'deal-1',
    });
  });

  it('refuses an unknown code', async () => {
    const { service } = makeService();
    await expect(service.resolve('999999')).resolves.toBeNull();
  });

  it('refuses anything that is not digits', async () => {
    const { service, repo } = makeService();

    await expect(service.resolve('abc')).resolves.toBeNull();
    await expect(service.resolve('')).resolves.toBeNull();
    // Never even asks the table — a malformed code is not a lookup.
    expect(repo.findByCode).not.toHaveBeenCalled();
  });

  it('refuses a released code', async () => {
    const { service } = makeService();
    const ext = await service.forDeal('deal-1');
    await service.releaseForDeal('deal-1');

    await expect(service.resolve(ext.code)).resolves.toBeNull();
  });
});

describe('ExtsService — rotation and quarantine', () => {
  it('rotate replaces the code and retires the old one', async () => {
    const { service } = makeService();
    const before = await service.forDeal('deal-1');

    const after = await service.rotate('deal-1');

    expect(after.code).not.toBe(before.code);
    await expect(service.resolve(before.code)).resolves.toBeNull();
    await expect(service.resolve(after.code)).resolves.toMatchObject({
      dealId: 'deal-1',
    });
  });

  /**
   * A code that connected somebody to the Hendersons must not, three weeks
   * later, connect somebody to the Wus — so the allocator's claim fails on ANY
   * existing row, released or not.
   */
  it('never re-mints a released code while its row survives', async () => {
    const { service, taken } = makeService();
    const first = await service.forDeal('deal-1');
    await service.releaseForDeal('deal-1');

    for (let i = 0; i < 50; i += 1) await service.forDeal(`deal-${i + 2}`);

    // The released row is still there, and still owned by its original job.
    expect(taken.get(first.code)).toMatchObject({
      dealId: 'deal-1',
      status: 'released',
    });
  });
});

/**
 * Workiz style: every client number on the job gets its own masked number —
 * the shared technician line plus a code of its own — so the technician at the
 * door picks the mobile or the landline just as the in-app buttons do.
 */
describe('ExtsService — one code per client number', () => {
  it('gives each phone position of a job its own code', async () => {
    const { service } = makeService();

    const first = await service.forDeal('deal-1', 0);
    const second = await service.forDeal('deal-1', 1);

    expect(second.code).not.toBe(first.code);
    expect(second).toMatchObject({ dealId: 'deal-1', phoneIndex: 1 });
  });

  it('is idempotent per position — a printed code keeps working', async () => {
    const { service } = makeService();

    const a = await service.forDeal('deal-1', 1);
    const b = await service.forDeal('deal-1', 1);

    expect(b.code).toBe(a.code);
  });

  it('defaults to the first number, as every caller before this did', async () => {
    const { service } = makeService();

    const implicit = await service.forDeal('deal-1');
    const explicit = await service.forDeal('deal-1', 0);

    expect(explicit.code).toBe(implicit.code);
  });

  it('mints the codes for every number on the job, in order', async () => {
    const { service } = makeService();

    const codes = await service.forDealPhones('deal-1', 3);

    expect(codes.map((c) => c.phoneIndex ?? 0)).toEqual([0, 1, 2]);
    expect(new Set(codes.map((c) => c.code)).size).toBe(3);
    // The same three on the next look.
    const again = await service.forDealPhones('deal-1', 3);
    expect(again.map((c) => c.code)).toEqual(codes.map((c) => c.code));
  });

  /** A job whose client has no number on file still gets the code it always had. */
  it('always mints at least the first number’s code', async () => {
    const { service } = makeService();

    const codes = await service.forDealPhones('deal-1', 0);

    expect(codes).toHaveLength(1);
    expect(codes[0].phoneIndex ?? 0).toBe(0);
  });

  /** Bounded: a client record with dozens of numbers must not mint dozens of codes. */
  it('caps how many numbers get a code', async () => {
    const { service } = makeService();

    const codes = await service.forDealPhones('deal-1', 500);

    expect(codes.length).toBeLessThanOrEqual(10);
  });

  /**
   * A code minted before codes were per number has no `phoneIndex` and sits on
   * the job's original pointer: it must keep naming the first number, so every
   * code already printed on a work order keeps working with no migration.
   */
  it('reads a code minted before positions existed as the first number’s', async () => {
    const { service, taken, byDeal } = makeService();
    taken.set('4729', {
      code: '4729',
      dealId: 'deal-1',
      status: 'active',
      createdAt: '2026-06-01T10:00:00.000Z',
    });
    byDeal.set('deal-1#0', '4729');

    await expect(service.forDeal('deal-1', 0)).resolves.toMatchObject({ code: '4729' });
    const codes = await service.forDealPhones('deal-1', 2);
    expect(codes[0].code).toBe('4729');
    await expect(service.resolve('4729')).resolves.toMatchObject({ dealId: 'deal-1' });
  });

  it('rotates one number’s code without disturbing the others', async () => {
    const { service } = makeService();
    const [first, second] = await service.forDealPhones('deal-1', 2);

    const rotated = await service.rotate('deal-1', 1);

    expect(rotated.code).not.toBe(second.code);
    expect(rotated.phoneIndex).toBe(1);
    await expect(service.resolve(second.code)).resolves.toBeNull();
    await expect(service.resolve(first.code)).resolves.toMatchObject({ dealId: 'deal-1' });
  });

  it('retires every number’s code when the job closes', async () => {
    const { service } = makeService();
    const codes = await service.forDealPhones('deal-1', 3);

    await service.releaseForDeal('deal-1');

    for (const ext of codes) {
      await expect(service.resolve(ext.code)).resolves.toBeNull();
    }
  });
});
