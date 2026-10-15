import { RedisService } from '@bitcrm/shared';
import { ConferenceService } from '../../../src/voice/conference.service';
import { CallsService } from '../../../src/calls/calls.service';
import { type TelephonyConfig } from '../../../src/telephony/telephony.config';

export const CONFIG: TelephonyConfig = {
  accountSid: 'AC00000000000000000000000000000000',
  authToken: 'the-auth-token',
  apiKey: 'SK00000000000000000000000000000000',
  apiSecret: 'the-api-secret',
  twimlAppSid: 'AP00000000000000000000000000000000',
  callerId: '+12624061115',
  // No per-market default in tests: the market chain falls straight
  // through to callerId, which is what the pre-masking behaviour was.
  defaultAreaCallerId: '',
  publicBaseUrl: 'https://example.ngrok-free.dev',
  tokenTtlSeconds: 3600,
  validateSignature: true,
};

/** Minimal in-memory ioredis stand-in covering the commands the service uses. */
export class FakeRedis {
  hashes = new Map<string, Record<string, string>>();
  sets = new Map<string, Set<string>>();
  strings = new Map<string, string>();

  async hset(key: string, obj: Record<string, string>) {
    this.hashes.set(key, { ...(this.hashes.get(key) ?? {}), ...obj });
  }
  async hgetall(key: string) {
    return this.hashes.get(key) ?? {};
  }
  async sadd(key: string, ...members: string[]) {
    const s = this.sets.get(key) ?? new Set<string>();
    members.forEach((m) => s.add(m));
    this.sets.set(key, s);
  }
  async srem(key: string, member: string) {
    this.sets.get(key)?.delete(member);
  }
  async scard(key: string) {
    return this.sets.get(key)?.size ?? 0;
  }
  async smembers(key: string) {
    return [...(this.sets.get(key) ?? [])];
  }
  async set(key: string, value: string, ..._args: unknown[]) {
    // supports SET key val EX ttl NX
    if (_args.includes('NX') && this.strings.has(key)) return null;
    this.strings.set(key, value);
    return 'OK';
  }
  async get(key: string) {
    return this.strings.get(key) ?? null;
  }
  async getdel(key: string) {
    const v = this.strings.get(key) ?? null;
    this.strings.delete(key);
    return v;
  }
  async del(...keys: string[]) {
    keys.forEach((k) => {
      this.hashes.delete(k);
      this.sets.delete(k);
      this.strings.delete(k);
    });
  }
  async expire(_key: string, _ttl: number) {
    return 1;
  }
  /** Round trips the service made, MULTI/EXEC counting as one. */
  roundTrips = 0;
  /** MULTI … EXEC over the hash commands, applied in order on exec. */
  multi() {
    const ops: Array<() => Promise<unknown>> = [];
    const chain = {
      hset: (k: string, v: Record<string, string>) => (ops.push(() => this.hset(k, v)), chain),
      expire: (k: string, ttl: number) => (ops.push(() => this.expire(k, ttl)), chain),
      exec: async () => {
        this.roundTrips += 1;
        const out: Array<[Error | null, unknown]> = [];
        for (const op of ops) out.push([null, await op()]);
        return out;
      },
    };
    return chain;
  }
}

/** Mock of the Twilio REST surface ConferenceService touches. */
export function makeFakeTwilio() {
  const participantsCreate = jest.fn().mockResolvedValue({ callSid: 'CAcustomerLeg' });
  /** Who is in the room — set per test to drive the participant-leave sweep. */
  const participantsList = jest.fn().mockResolvedValue([]);
  const conferenceUpdate = jest.fn().mockResolvedValue({});
  /** One participant's update (hold, endConferenceOnExit…), as (callSid, params). */
  const participantUpdate = jest.fn().mockResolvedValue({});
  const conferenceFetch = jest.fn().mockResolvedValue({ status: 'in-progress' });
  const callsCreate = jest.fn().mockImplementation(async ({ to }: { to: string }) => ({
    sid: `CAleg-${to.replace('client:', '')}`,
  }));
  const callUpdate = jest.fn().mockResolvedValue({});
  /** The caller's leg. Ended by default — tests that keep them on say so. */
  const callFetch = jest.fn().mockResolvedValue({ status: 'completed' });

  const client = {
    conferences: Object.assign(
      (sid: string) => ({
        participants: Object.assign(
          (callSid: string) => ({
            update: (params: unknown) => participantUpdate(callSid, params),
            remove: jest.fn().mockResolvedValue({}),
            callSid,
          }),
          { create: participantsCreate, list: participantsList },
        ),
        update: conferenceUpdate,
        fetch: conferenceFetch,
        sid,
      }),
      {},
    ),
    calls: Object.assign(
      (sid: string) => ({ update: callUpdate, fetch: callFetch, sid }),
      { create: callsCreate },
    ),
  };

  return {
    client,
    participantsCreate,
    participantsList,
    participantUpdate,
    callFetch,
    conferenceUpdate,
    conferenceFetch,
    callsCreate,
    callUpdate,
  };
}

export function makeHarness(opts: { queue?: unknown } = {}) {
  const redis = new FakeRedis();
  /** The per-user bridge claim is what stops a technician placing their next
   *  call, so tests need to see it dropped. */
  const bridge = {
    release: jest.fn().mockResolvedValue(undefined),
    advance: jest.fn().mockResolvedValue(null),
  };
  const twilio = makeFakeTwilio();
  const applied: any[] = [];
  // Stateful mock: applyLifecycle merges into an in-memory record store so
  // getBySid reflects what the orchestration has written (answeredAt, childSids).
  const records = new Map<string, any>();
  const callsService = {
    applyLifecycle: jest.fn().mockImplementation(async (u: any) => {
      applied.push(u);
      const merged = { ...(records.get(u.callSid) ?? {}), ...u };
      records.set(u.callSid, merged);
      return merged;
    }),
    getBySid: jest
      .fn()
      .mockImplementation(async (sid: string) => records.get(sid) ?? null),
    appendChildSid: jest.fn().mockImplementation(async (sid: string, child: string) => {
      const rec = records.get(sid) ?? { callSid: sid };
      rec.childSids = [...(rec.childSids ?? []), child];
      records.set(sid, rec);
    }),
    appendParticipant: jest.fn().mockImplementation(async (sid: string, p: any) => {
      const rec = records.get(sid) ?? { callSid: sid };
      rec.participants = [...(rec.participants ?? []), p];
      records.set(sid, rec);
    }),
    listLive: jest
      .fn()
      .mockImplementation(async () =>
        [...records.values()].filter((r) =>
          ['queued', 'initiated', 'ringing', 'in-progress'].includes(r.status),
        ),
      ),
  } as unknown as CallsService;

  const service = new ConferenceService(
    CONFIG,
    { client: redis } as unknown as RedisService,
    callsService,
    undefined,
    bridge as never,
    opts.queue as never,
  );
  (service as any).rest = {
    client: twilio.client,
    run: (fn: (c: unknown) => Promise<unknown>) => fn(twilio.client),
  };

  return { service, redis, twilio, callsService, applied, records, bridge };
}
