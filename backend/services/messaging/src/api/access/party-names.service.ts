import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { hasPermission } from '@bitcrm/shared';
import {
  type Conversation,
  type ConversationListIncluded,
  type PartyName,
  type ResolvedPermissions,
} from '@bitcrm/types';
import { INTERNAL_FETCH, defaultFetch, type FetchLike } from '../../outbound/internal/internal-fetch';

/** The list renders without the names, so it never waits long for them. */
const NAMES_TIMEOUT_MS = 3_000;
/** crm's `internal/by-ids` and user-service's `internal/names-by-ids` both cap a body at 200. */
const MAX_IDS = 200;

type PartyRef = { kind: 'contact' | 'company'; id: string };

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
 * **Names only.** Both routes are internal and mask nothing; nothing but
 * `{ id, name }` is copied out of their answers, field by field.
 *
 * **Same audience as before.** Contacts are named only for a viewer with
 * `contacts.view` and companies only for `companies.view`, exactly the
 * reads the browser used to make on their behalf. Teammates' names go to
 * anyone, as user-service's own `POST /users/by-ids` does.
 *
 * Best effort, like an event publish: a peer that is down, slow or
 * answering nonsense costs its part of the block and a warning, never the
 * page.
 */
@Injectable()
export class PartyNamesService {
  private readonly logger = new Logger(PartyNamesService.name);

  constructor(
    @Optional() @Inject(INTERNAL_FETCH) private readonly fetchImpl: FetchLike = defaultFetch,
  ) {}

  async forPage(conversations: Conversation[], perms?: ResolvedPermissions): Promise<ConversationListIncluded> {
    const seesContacts = hasPermission(perms, 'contacts', 'view');
    const seesCompanies = hasPermission(perms, 'companies', 'view');

    const refs = new Map<string, PartyRef>();
    const userIds = new Set<string>();
    for (const c of conversations) {
      if (!c.partyId) continue;
      if (c.partyKind === 'contact' && seesContacts) refs.set(`contact:${c.partyId}`, { kind: 'contact', id: c.partyId });
      else if (c.partyKind === 'company' && seesCompanies) refs.set(`company:${c.partyId}`, { kind: 'company', id: c.partyId });
      else if (c.partyKind === 'user') userIds.add(c.partyId);
    }

    const [parties, users] = await Promise.all([
      this.crmNames([...refs.values()].slice(0, MAX_IDS)),
      this.userNames([...userIds].slice(0, MAX_IDS)),
    ]);
    return { contacts: parties.contacts, companies: parties.companies, users };
  }

  /** crm `POST /contacts/internal/by-ids` — `{ '<kind>:<id>': { kind, id, name } }`. */
  private async crmNames(refs: PartyRef[]): Promise<{ contacts: PartyName[]; companies: PartyName[] }> {
    const none = { contacts: [], companies: [] };
    if (!refs.length) return none;
    const base = process.env.CRM_SERVICE_URL || 'http://localhost:4002';
    const data = await this.post(`${base}/api/crm/contacts/internal/by-ids`, { refs }, `names for ${refs.length} parties`);
    if (!data || typeof data !== 'object' || Array.isArray(data)) return none;

    const contacts: PartyName[] = [];
    const companies: PartyName[] = [];
    for (const ref of refs) {
      const row = (data as Record<string, unknown>)[`${ref.kind}:${ref.id}`] as { name?: unknown } | undefined;
      const name = typeof row?.name === 'string' ? row.name.trim() : '';
      if (!name) continue;
      (ref.kind === 'contact' ? contacts : companies).push({ id: ref.id, name });
    }
    return { contacts, companies };
  }

  /** user-service `POST /users/internal/names-by-ids` — `[{ id, firstName, lastName }]`. */
  private async userNames(ids: string[]): Promise<PartyName[]> {
    if (!ids.length) return [];
    const base = process.env.USER_SERVICE_URL || 'http://localhost:4001';
    const data = await this.post(`${base}/api/users/internal/names-by-ids`, { userIds: ids }, `names for ${ids.length} users`);
    if (!Array.isArray(data)) return [];

    const out: PartyName[] = [];
    for (const row of data as Array<Record<string, unknown>>) {
      if (!row || typeof row.id !== 'string') continue;
      const first = typeof row.firstName === 'string' ? row.firstName : '';
      const last = typeof row.lastName === 'string' ? row.lastName : '';
      const name = `${first} ${last}`.trim();
      if (name) out.push({ id: row.id, name });
    }
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
