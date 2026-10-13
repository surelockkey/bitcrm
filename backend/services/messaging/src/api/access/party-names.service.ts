import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { RedisService, hasPermission } from '@bitcrm/shared';
import {
  type Conversation,
  type ConversationListIncluded,
  type ResolvedPermissions,
} from '@bitcrm/types';
import { INTERNAL_FETCH, defaultFetch, type FetchLike } from '../../outbound/internal/internal-fetch';

/** The list renders without the names, so it never waits long for them. */
const NAMES_TIMEOUT_MS = 3_000;
/** crm's `internal/by-ids` and user-service's `internal/names-by-ids` both cap a body at 200. */
const MAX_IDS = 200;
/** How long a name is reused. A rename shows within this (sooner for a contact: `contact.updated` drops it). */
export const PARTY_NAME_TTL_SECONDS = 10 * 60;
/** How long "the peer answered and named nobody by that id" is reused. */
export const PARTY_NAME_UNKNOWN_TTL_SECONDS = 5 * 60;

type PartyKind = 'contact' | 'company' | 'user';
type PartyRef = { kind: PartyKind; id: string };
/** A name; `null` = the peer answered and knows nobody by that id; `undefined` = no answer. */
type Lookup = string | null | undefined;

/** One party's cached name. Shared by every task. */
export const partyNameKey = (kind: PartyKind, id: string) => `messaging:party-name:${kind}:${id}`;

/** Drop one party's cached name — on `contact.updated`. Best effort, never throws. */
export async function forgetPartyName(redis: RedisService | undefined, kind: PartyKind, id: string): Promise<void> {
  if (!redis) return;
  try {
    await redis.client.del(partyNameKey(kind, id));
  } catch {
    // The TTL takes it out anyway.
  }
}

const refKey = (r: PartyRef) => `${r.kind}:${r.id}`;

/**
 * Names for the parties a page of the inbox refers to — the `included`
 * block of `GET /conversations`.
 *
 * A conversation stores only `partyKind` / `partyId`. Naming fifty rows used
 * to be the browser's job: three more requests that could not start until
 * the list came back, so every row painted with a number first. Here it is
 * two internal calls, sent together — crm names contacts and companies in
 * one body, user-service names teammates — with a deadline each.
 *
 * **Cached per party in Redis** (`partyNameKey`): a name for
 * `PARTY_NAME_TTL_SECONDS`, "nobody by that id" for
 * `PARTY_NAME_UNKNOWN_TTL_SECONDS`, a failed or malformed answer never. A
 * page reads every key in one `MGET`, sends only its misses (still one body
 * per peer), and a miss another request of this task is already fetching
 * is waited for, not fetched again. Redis being down means no cache, not
 * an error.
 *
 * **Names only.** Both routes are internal and mask nothing; nothing but
 * `{ id, name }` is copied out of their answers, field by field.
 *
 * **Same audience as before.** Contacts are named only for a viewer with
 * `contacts.view` and companies only for `companies.view`, exactly the
 * reads the browser used to make on their behalf — checked before the
 * cache is consulted. Teammates' names go to anyone, as user-service's own
 * `POST /users/by-ids` does.
 *
 * Best effort, like an event publish: a peer that is down, slow or
 * answering nonsense costs its part of the block and a warning, never the
 * page.
 */
@Injectable()
export class PartyNamesService {
  private readonly logger = new Logger(PartyNamesService.name);
  /** Misses being fetched right now, by `kind:id` — the single flight. */
  private readonly inflight = new Map<string, Promise<Lookup>>();

  constructor(
    @Optional() @Inject(INTERNAL_FETCH) private readonly fetchImpl: FetchLike = defaultFetch,
    @Optional() private readonly redis?: RedisService,
  ) {}

  async forPage(conversations: Conversation[], perms?: ResolvedPermissions): Promise<ConversationListIncluded> {
    const seesContacts = hasPermission(perms, 'contacts', 'view');
    const seesCompanies = hasPermission(perms, 'companies', 'view');

    const parties = new Map<string, PartyRef>();
    const users = new Map<string, PartyRef>();
    for (const c of conversations) {
      if (!c.partyId) continue;
      if (c.partyKind === 'contact' && seesContacts) parties.set(`contact:${c.partyId}`, { kind: 'contact', id: c.partyId });
      else if (c.partyKind === 'company' && seesCompanies) parties.set(`company:${c.partyId}`, { kind: 'company', id: c.partyId });
      else if (c.partyKind === 'user') users.set(`user:${c.partyId}`, { kind: 'user', id: c.partyId });
    }

    const wanted = [...[...parties.values()].slice(0, MAX_IDS), ...[...users.values()].slice(0, MAX_IDS)];
    const names = await this.lookup(wanted);

    const included: ConversationListIncluded = { contacts: [], companies: [], users: [] };
    for (const ref of wanted) {
      const name = names.get(refKey(ref));
      if (!name) continue;
      const list = ref.kind === 'contact' ? included.contacts : ref.kind === 'company' ? included.companies : included.users;
      list.push({ id: ref.id, name });
    }
    return included;
  }

  /** Cache, then the in-flight fetches, then one batch for whatever is left. */
  private async lookup(wanted: PartyRef[]): Promise<Map<string, Lookup>> {
    const out = await this.readCache(wanted);
    const pending: Array<Promise<void>> = [];
    const toFetch: PartyRef[] = [];
    for (const ref of wanted) {
      const key = refKey(ref);
      if (out.has(key)) continue;
      const flying = this.inflight.get(key);
      if (flying) pending.push(flying.then((v) => void out.set(key, v)));
      else toFetch.push(ref);
    }

    if (toFetch.length) {
      const batch = this.fetchNames(toFetch);
      for (const ref of toFetch) {
        const key = refKey(ref);
        const one = batch.then((m) => m.get(key));
        this.inflight.set(key, one);
        const clear = () => {
          if (this.inflight.get(key) === one) this.inflight.delete(key);
        };
        one.then(clear, clear);
        pending.push(one.then((v) => void out.set(key, v)));
      }
      pending.push(batch.then((m) => this.writeCache(m)));
    }

    await Promise.all(pending);
    return out;
  }

  /** Both peers, together; a ref whose peer failed maps to `undefined`. Never rejects. */
  private async fetchNames(refs: PartyRef[]): Promise<Map<string, Lookup>> {
    const crmRefs = refs.filter((r) => r.kind !== 'user');
    const userIds = refs.filter((r) => r.kind === 'user').map((r) => r.id);
    const [crm, users] = await Promise.all([this.crmNames(crmRefs), this.userNames(userIds)]);
    return new Map([...crm, ...users]);
  }

  /** `kind:id` → what Redis holds; a key it does not hold is left out. */
  private async readCache(refs: PartyRef[]): Promise<Map<string, Lookup>> {
    const out = new Map<string, Lookup>();
    if (!this.redis || !refs.length) return out;
    try {
      const raw = await this.redis.client.mget(...refs.map((r) => partyNameKey(r.kind, r.id)));
      refs.forEach((ref, i) => {
        const value = raw[i];
        if (value === null || value === undefined) return;
        let parsed: { n?: unknown } | null = null;
        try {
          parsed = JSON.parse(value) as { n?: unknown };
        } catch {
          return; // an older shape of this code: a miss
        }
        if (typeof parsed?.n === 'string' || parsed?.n === null) out.set(refKey(ref), parsed.n as string | null);
      });
    } catch (error) {
      this.logger.warn(`party-name cache read failed: ${error instanceof Error ? error.message : error}`);
    }
    return out;
  }

  /** Answers only — `undefined` (no answer) is never written. */
  private async writeCache(found: Map<string, Lookup>): Promise<void> {
    if (!this.redis) return;
    const entries = [...found].filter(([, v]) => v !== undefined);
    if (!entries.length) return;
    try {
      const pipeline = this.redis.client.pipeline();
      for (const [key, name] of entries) {
        const [kind, ...rest] = key.split(':');
        pipeline.set(
          partyNameKey(kind as PartyKind, rest.join(':')),
          JSON.stringify({ n: name }),
          'EX',
          name === null ? PARTY_NAME_UNKNOWN_TTL_SECONDS : PARTY_NAME_TTL_SECONDS,
        );
      }
      await pipeline.exec();
    } catch (error) {
      this.logger.warn(`party-name cache write failed: ${error instanceof Error ? error.message : error}`);
    }
  }

  /** crm `POST /contacts/internal/by-ids` — `{ '<kind>:<id>': { kind, id, name } }`. */
  private async crmNames(refs: PartyRef[]): Promise<Map<string, Lookup>> {
    const out = new Map<string, Lookup>();
    if (!refs.length) return out;
    const base = process.env.CRM_SERVICE_URL || 'http://localhost:4002';
    const data = await this.post(`${base}/api/crm/contacts/internal/by-ids`, { refs }, `names for ${refs.length} parties`);
    const answered = !!data && typeof data === 'object' && !Array.isArray(data);

    for (const ref of refs) {
      if (!answered) {
        out.set(refKey(ref), undefined);
        continue;
      }
      const row = (data as Record<string, unknown>)[refKey(ref)] as { name?: unknown } | undefined;
      const name = typeof row?.name === 'string' ? row.name.trim() : '';
      out.set(refKey(ref), name || null);
    }
    return out;
  }

  /** user-service `POST /users/internal/names-by-ids` — `[{ id, firstName, lastName }]`. */
  private async userNames(ids: string[]): Promise<Map<string, Lookup>> {
    const out = new Map<string, Lookup>();
    if (!ids.length) return out;
    const base = process.env.USER_SERVICE_URL || 'http://localhost:4001';
    const data = await this.post(`${base}/api/users/internal/names-by-ids`, { userIds: ids }, `names for ${ids.length} users`);
    const answered = Array.isArray(data);

    const byId = new Map<string, string>();
    if (answered) {
      for (const row of data as Array<Record<string, unknown>>) {
        if (!row || typeof row.id !== 'string') continue;
        const first = typeof row.firstName === 'string' ? row.firstName : '';
        const last = typeof row.lastName === 'string' ? row.lastName : '';
        const name = `${first} ${last}`.trim();
        if (name) byId.set(row.id, name);
      }
    }
    for (const id of ids) out.set(`user:${id}`, answered ? (byId.get(id) ?? null) : undefined);
    return out;
  }

  /** The `data` of a 200, or `undefined` for anything else — never throws. */
  private async post(url: string, body: unknown, what: string): Promise<unknown> {
    try {
      const res = await this.fetchImpl(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-internal-secret': process.env.INTERNAL_SERVICE_SECRET || '' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(NAMES_TIMEOUT_MS),
      });
      if (!res.ok) {
        this.logger.warn(`${what} returned ${res.status}`);
        return undefined;
      }
      return ((await res.json()) as { data?: unknown })?.data;
    } catch (error) {
      this.logger.warn(`${what} failed: ${error instanceof Error ? error.message : error}`);
      return undefined;
    }
  }
}
