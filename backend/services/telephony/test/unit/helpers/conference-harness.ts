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
}

/** Mock of the Twilio REST surface ConferenceService touches. */
export function makeFakeTwilio() {
  const participantsCreate = jest.fn().mockResolvedValue({ callSid: 'CAcustomerLeg' });
  /** Who is in the room — set per test to drive the participant-leave sweep. */
  const participantsList = jest.fn().mockResolvedValue([]);
  const conferenceUpdate = jest.fn().mockResolvedValue({});
  const conferenceFetch = jest.fn().mockResolvedValue({ status: 'in-progress' });
  const callsCreate = jest.fn().mockImplementation(async ({ to }: { to: string }) => ({
    sid: `CAleg-${to.replace('client:', '')}`,
  }));
  const callUpdate = jest.fn().mockResolvedValue({});

  const client = {
    conferences: Object.assign(
      (sid: string) => ({
        participants: Object.assign(
          (callSid: string) => ({ update: jest.fn().mockResolvedValue({}), remove: jest.fn().mockResolvedValue({}), callSid }),
          { create: participantsCreate, list: participantsList },
        ),
        update: conferenceUpdate,
        fetch: conferenceFetch,
        sid,
      }),
      {},
    ),
    calls: Object.assign((sid: string) => ({ update: callUpdate, sid }), {
      create: callsCreate,
    }),
  };

  return {
    client,
    participantsCreate,
    participantsList,
    conferenceUpdate,
    conferenceFetch,
    callsCreate,
    callUpdate,
  };
}

export function makeHarness() {
  const redis = new FakeRedis();
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
  );
  (service as any).rest = {
    client: twilio.client,
    run: (fn: (c: unknown) => Promise<unknown>) => fn(twilio.client),
  };

  return { service, redis, twilio, callsService, applied, records };
}
