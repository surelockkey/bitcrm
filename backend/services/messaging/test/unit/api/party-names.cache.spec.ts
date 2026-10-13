import {
  PARTY_NAME_TTL_SECONDS,
  PARTY_NAME_UNKNOWN_TTL_SECONDS,
  PartyNamesService,
  forgetPartyName,
  partyNameKey,
} from '../../../src/api/access/party-names.service';
import { FakeRedis, fakeRedisService } from '../fake-redis';
import { createMockConversation } from '../mocks';
import { adminPerms } from './api-mocks';

/**
 * The inbox's `included` names come out of a per-party Redis cache (B5):
 * a name is kept 10 minutes, "nobody by that id" 5, a failed call not at
 * all; only the misses of a page go to crm / user-service, batched, and a
 * miss already being fetched is waited for rather than fetched twice.
 */
type Call = { url: string; body: any };

function json(data: unknown, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => ({ success: true, data }) } as Response;
}

const crmAnswer: Record<string, unknown> = {
  'contact:ct1': { kind: 'contact', id: 'ct1', name: 'Jane Smith' },
  'contact:ct2': { kind: 'contact', id: 'ct2', name: 'John Doe' },
};
const usersAnswer = [{ id: 'u1', firstName: 'Bob', lastName: 'Ray' }];

function peers(url: string) {
  if (url.includes('/api/crm/contacts/internal/by-ids')) return json(crmAnswer);
  if (url.includes('/api/users/internal/names-by-ids')) return json(usersAnswer);
  return json(null, 404);
}

function make(answer: (url: string, body: any) => Response | Promise<Response> = peers, redis = new FakeRedis()) {
  const calls: Call[] = [];
  const fetchImpl = jest.fn(async (url: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ url, body });
    return answer(url, body);
  });
  return { svc: new PartyNamesService(fetchImpl, fakeRedisService(redis)), calls, fetchImpl, redis };
}

const thread = (id: string, partyKind: 'contact' | 'user', partyId: string) =>
  createMockConversation({ id, kind: partyKind === 'user' ? 'team' : 'client', partyKind, partyId });
const ct1 = thread('c1', 'contact', 'ct1');
const ct2 = thread('c2', 'contact', 'ct2');
const ghost = thread('c3', 'contact', 'gone');
const u1 = thread('c4', 'user', 'u1');
const crmCalls = (calls: Call[]) => calls.filter((c) => c.url.includes('/api/crm/'));

describe('PartyNamesService cache', () => {
  it('serves a name it has already fetched without asking anybody, for 10 minutes', async () => {
    const { svc, fetchImpl, redis } = make();
    const first = await svc.forPage([ct1, u1], adminPerms());
    const second = await svc.forPage([ct1, u1], adminPerms());

    expect(second).toEqual(first);
    expect(second).toEqual({ contacts: [{ id: 'ct1', name: 'Jane Smith' }], companies: [], users: [{ id: 'u1', name: 'Bob Ray' }] });
    expect(fetchImpl).toHaveBeenCalledTimes(2); // the first page only: crm + users
    expect(redis.ttl(partyNameKey('contact', 'ct1'))).toBe(PARTY_NAME_TTL_SECONDS);
    expect(redis.ttl(partyNameKey('user', 'u1'))).toBe(PARTY_NAME_TTL_SECONDS);
    expect(PARTY_NAME_TTL_SECONDS).toBe(600);
  });

  it('asks only for the misses of a page, in one batch', async () => {
    const { svc, calls } = make();
    await svc.forPage([ct1], adminPerms());
    const included = await svc.forPage([ct1, ct2], adminPerms());

    expect(included.contacts).toEqual([{ id: 'ct1', name: 'Jane Smith' }, { id: 'ct2', name: 'John Doe' }]);
    expect(crmCalls(calls).map((c) => c.body)).toEqual([
      { refs: [{ kind: 'contact', id: 'ct1' }] },
      { refs: [{ kind: 'contact', id: 'ct2' }] },
    ]);
  });

  it('remembers "nobody by that id" for 5 minutes', async () => {
    const { svc, calls, redis } = make();
    await svc.forPage([ghost], adminPerms());
    expect(await svc.forPage([ghost], adminPerms())).toEqual({ contacts: [], companies: [], users: [] });
    expect(crmCalls(calls)).toHaveLength(1);
    expect(redis.ttl(partyNameKey('contact', 'gone'))).toBe(PARTY_NAME_UNKNOWN_TTL_SECONDS);
    expect(PARTY_NAME_UNKNOWN_TTL_SECONDS).toBe(300);

    redis.now += PARTY_NAME_UNKNOWN_TTL_SECONDS * 1000 + 1;
    await svc.forPage([ghost], adminPerms());
    expect(crmCalls(calls)).toHaveLength(2);
  });

  it('never caches a failed call', async () => {
    let down = true;
    const { svc, calls, redis } = make((url, body) => (down && url.includes('/api/crm/') ? json(null, 503) : peers(url)));
    expect((await svc.forPage([ct1], adminPerms())).contacts).toEqual([]);
    expect(redis.peek(partyNameKey('contact', 'ct1'))).toBeNull();

    down = false;
    expect((await svc.forPage([ct1], adminPerms())).contacts).toEqual([{ id: 'ct1', name: 'Jane Smith' }]);
    expect(crmCalls(calls)).toHaveLength(2);
  });

  it('never caches a malformed answer either', async () => {
    const { svc, redis } = make((url) => (url.includes('/api/users/') ? json({ nope: true }) : peers(url)));
    await svc.forPage([u1], adminPerms());
    expect(redis.peek(partyNameKey('user', 'u1'))).toBeNull();
  });

  it('single-flights a miss two requests ask for at once', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const { svc, calls } = make(async (url) => {
      await gate;
      return peers(url);
    });

    const both = Promise.all([svc.forPage([ct1], adminPerms()), svc.forPage([ct1, ct2], adminPerms())]);
    await new Promise((r) => setTimeout(r, 5));
    release();
    const [a, b] = await both;

    expect(a.contacts).toEqual([{ id: 'ct1', name: 'Jane Smith' }]);
    expect(b.contacts).toEqual([{ id: 'ct1', name: 'Jane Smith' }, { id: 'ct2', name: 'John Doe' }]);
    expect(crmCalls(calls).map((c) => c.body.refs.map((r: { id: string }) => r.id))).toEqual([['ct1'], ['ct2']]);
  });

  it('still applies the viewer\'s permissions to a cached name', async () => {
    const { svc } = make();
    await svc.forPage([ct1], adminPerms());
    const noContacts = adminPerms({ permissions: { ...adminPerms().permissions, contacts: { view: false } } });
    expect((await svc.forPage([ct1], noContacts)).contacts).toEqual([]);
  });

  it('works as before when Redis is down', async () => {
    const redis = new FakeRedis();
    redis.down();
    const { svc, fetchImpl } = make(peers, redis);
    expect((await svc.forPage([ct1], adminPerms())).contacts).toEqual([{ id: 'ct1', name: 'Jane Smith' }]);
    await svc.forPage([ct1], adminPerms());
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('forgetPartyName drops one party (contact.updated)', async () => {
    const { svc, calls, redis } = make();
    await svc.forPage([ct1], adminPerms());
    await forgetPartyName(fakeRedisService(redis), 'contact', 'ct1');
    await svc.forPage([ct1], adminPerms());
    expect(crmCalls(calls)).toHaveLength(2);
    await expect(forgetPartyName(undefined, 'contact', 'ct1')).resolves.toBeUndefined();
  });
});
