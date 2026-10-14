import { TwilioRest } from '@bitcrm/shared';
import { NumbersService } from '../../src/numbers/numbers.service';
import { type TelephonyConfig } from '../../src/telephony/telephony.config';
import { FakeRedisKv } from './helpers/fake-redis-kv';

/**
 * `GET /numbers` and `/numbers/internal/owned` walked Twilio's paged number
 * list (and every Messaging Service's members, one after another) on every
 * request — ~300 ms p50, >1 s p95. Both are now cached in Redis, shared by
 * every task, and dropped by every path here that buys or releases a number.
 */

const CONFIG = {
  accountSid: 'AC00000000000000000000000000000000',
  authToken: 'the-auth-token',
  publicBaseUrl: 'https://api.example.test',
} as TelephonyConfig;

const num = (i: number) => ({
  sid: `PN${i}`,
  phoneNumber: `+1555000000${i}`,
  friendlyName: `Line ${i}`,
  voiceUrl: 'https://x/inbound',
  smsUrl: '',
  dateCreated: new Date('2026-01-02T03:04:05.000Z'),
  capabilities: { sms: true, mms: false, voice: true },
});

function make(opts: { redis?: FakeRedisKv; services?: Record<string, string[]> } = {}) {
  const redis = opts.redis ?? new FakeRedisKv();
  let numbers = [num(1), num(2)];
  const page = jest.fn(async () => ({ instances: numbers, nextPage: () => undefined }));
  const services = opts.services ?? { MG1: ['+15550000001'], MG2: ['+15550000002'] };
  const servicesList = jest.fn(async () => Object.keys(services).map((sid) => ({ sid })));
  const membersList = jest.fn(async (sid: string) =>
    (services[sid] ?? []).map((phoneNumber) => ({ phoneNumber })),
  );
  const create = jest.fn(async ({ phoneNumber }: { phoneNumber: string }) => ({
    sid: 'PNnew',
    phoneNumber,
    friendlyName: phoneNumber,
    voiceUrl: 'https://x/inbound',
  }));
  const remove = jest.fn(async () => true);
  const client = {
    incomingPhoneNumbers: Object.assign(() => ({ remove }), { page, create }),
    messaging: {
      v1: {
        services: Object.assign(
          (sid: string) => ({ phoneNumbers: { list: () => membersList(sid) } }),
          { list: servicesList },
        ),
      },
    },
  };
  const service = new NumbersService(CONFIG, { client: redis } as never);
  (service as any).rest = new TwilioRest(CONFIG, () => client as never);
  return {
    service,
    redis,
    page,
    servicesList,
    membersList,
    create,
    remove,
    setNumbers: (n: ReturnType<typeof num>[]) => (numbers = n),
  };
}

describe('NumbersService — owned numbers cache', () => {
  it('walks Twilio once; later reads (any shape) come from the cache', async () => {
    const { service, page } = make();
    const first = await service.listOwned();
    const second = await service.listOwned();
    const detailed = await service.listOwnedDetailed();

    expect(page).toHaveBeenCalledTimes(1);
    expect(second).toEqual(first);
    expect(first[0]).toEqual({
      sid: 'PN1',
      phoneNumber: '+15550000001',
      friendlyName: 'Line 1',
      voiceUrl: 'https://x/inbound',
      dateCreated: '2026-01-02T03:04:05.000Z',
    });
    expect(detailed[0]).toMatchObject({
      sid: 'PN1',
      smsUrl: '',
      capabilities: { sms: true, mms: false, voice: true },
    });
  });

  it('is shared across tasks through Redis', async () => {
    const a = make();
    await a.service.listOwned();
    const b = make({ redis: a.redis });
    await b.service.listOwned();
    expect(b.page).not.toHaveBeenCalled();
  });

  it('buying a number drops the cache — the next read sees it', async () => {
    const { service, page, setNumbers } = make();
    await service.listOwned();
    await service.buy('+15550000009');
    setNumbers([num(1), num(2), num(9)]);

    const owned = await service.listOwned();
    expect(page).toHaveBeenCalledTimes(2);
    expect(owned.map((n) => n.sid)).toContain('PN9');
  });

  it('releasing a number drops the cache', async () => {
    const { service, page, setNumbers } = make();
    await service.listOwned();
    await service.release('PN2');
    setNumbers([num(1)]);

    expect(await service.listOwned()).toHaveLength(1);
    expect(page).toHaveBeenCalledTimes(2);
  });

  it('a refused release (still referenced) leaves the cache alone', async () => {
    const { service, page } = make();
    await service.listOwned();
    await expect(
      service.release('PN2', { referencedBy: async () => ['the "Main" call flow'] }),
    ).rejects.toThrow(/still in use/);
    await service.listOwned();
    expect(page).toHaveBeenCalledTimes(1);
  });

  it('a Twilio failure with nothing cached still surfaces (never cached)', async () => {
    const { service, page } = make();
    page.mockRejectedValueOnce(Object.assign(new Error('Twilio down'), { status: 503 }));
    await expect(service.listOwned()).rejects.toBeDefined();
    expect(await service.listOwned()).toHaveLength(2);
  });
});

describe('NumbersService — Messaging Service membership cache', () => {
  it('reads every service once, then serves the cached map', async () => {
    const { service, membersList, servicesList } = make();
    const first = await service.messagingServiceMembership();
    const second = await service.messagingServiceMembership();

    expect(servicesList).toHaveBeenCalledTimes(1);
    expect(membersList).toHaveBeenCalledTimes(2); // MG1 + MG2, once
    expect(second).toEqual(first);
    expect(first.get('+15550000002')).toBe('MG2');
  });

  it('first service listed still wins when a number sits in two (lists run in parallel)', async () => {
    const { service } = make({ services: { MGa: ['+15550000001'], MGb: ['+15550000001'] } });
    expect((await service.messagingServiceMembership()).get('+15550000001')).toBe('MGa');
  });

  it('a failure is NOT cached as "no membership"', async () => {
    const { service, servicesList } = make();
    servicesList.mockRejectedValueOnce(new Error('messaging API 500'));
    expect((await service.messagingServiceMembership()).size).toBe(0);
    expect((await service.messagingServiceMembership()).size).toBe(2);
  });

  it('buying / releasing a number drops the membership cache too', async () => {
    const { service, servicesList } = make();
    await service.messagingServiceMembership();
    await service.release('PN2');
    await service.messagingServiceMembership();
    expect(servicesList).toHaveBeenCalledTimes(2);
  });
});
