import type {
  ConversationKind,
  InboxCounters,
  TeamChatCounters,
} from '@bitcrm/types';
import { ApiError } from '../../lib/api/errors';
import type { InboxConversation, TeamThread } from './api';
import type { ThreadAudience } from './lib';

/**
 * One list of conversations with four filter chips — Workiz's Messages screen
 * on a phone, read off the live app: `All (0)` · `Requests (0)` ·
 * `Clients (0)` · `Team (0)`, a search above them, `No results found` when
 * nothing matches (`docs/import/WORKIZ_APP_SCREENS_LIVE.md` §5).
 *
 * Every rule about which chip a thread sits under, what its count says and
 * what a technician is allowed to be shown is a pure function here rather
 * than a branch inside the screen — the same reason `./lib.ts` exists. The
 * category mapping is the web Inbox's, kind for kind
 * (`apps/web/features/messaging/lib.ts:76-124`), so a chip called "Clients"
 * in a van and a tab called "Clients" in the office hold the same threads.
 */

/* ------------------------------------------------------------ categories */

export type InboxCategory = 'all' | 'requests' | 'clients' | 'team';

/** Workiz's own words, in Workiz's own order. */
export const CATEGORY_LABEL: Record<InboxCategory, string> = {
  all: 'All',
  requests: 'Requests',
  clients: 'Clients',
  team: 'Team',
};

/**
 * All four, always, in this order.
 *
 * Requests maps to the `unknown` kind exactly as the web Inbox maps it, and a
 * technician can never be handed one: under `assigned_only` the server builds
 * the inbox from `CONVOF#` pointers of kind contact / company / user / group
 * (`conversation-scope.service.ts:113-137`), while an `unknown` thread is keyed
 * by its address (`CONVOF#address#<e164>`) — a pointer that walk never looks
 * up. It is drawn anyway, because the live app was read off a **technician**
 * account with nothing assigned to it and still printed
 * `All (0) · Requests (0) · Clients (0) · Team (0)`
 * (`docs/import/WORKIZ_APP_SCREENS_LIVE.md` §5). These are men who have used
 * that screen for years; a row of chips that changes length with the data
 * moves Team out from under a thumb that already knows where it is.
 */
export const CATEGORY_ORDER: readonly InboxCategory[] = [
  'all',
  'requests',
  'clients',
  'team',
];

/**
 * Which chip a thread belongs under.
 *
 * `unknown` — a number or email that resolved to nobody in CRM — is Workiz's
 * "Requests": an enquiry from somebody who is not a client yet. `group` sits
 * under Team with the office thread, because a technician does not
 * distinguish "dispatch" from "dispatch and two other vans"; both are people
 * inside the company. `external` (an outside company) has no chip of its own
 * in Workiz and falls to All only.
 */
export function categoryOfKind(kind: ConversationKind): InboxCategory | undefined {
  switch (kind) {
    case 'unknown':
      return 'requests';
    case 'client':
      return 'clients';
    case 'team':
    case 'group':
      return 'team';
    default:
      return undefined;
  }
}

/** Whether a row is shown under a chip. `all` holds everything, including `external`. */
export function inCategory(kind: ConversationKind, cat: InboxCategory): boolean {
  return cat === 'all' || categoryOfKind(kind) === cat;
}

/**
 * Which thread this is, for everything downstream of the list: the audience
 * decides the words, the outbox kind and the side of the screen a bubble sits
 * on (`./lib.ts` — `audienceChrome`, `feedRows` vs `clientFeedRows`).
 *
 * Only `team` and `group` are the office. Everything else is somebody outside
 * the company, and an outsider must never be dressed in the office thread's
 * quiet blue strip.
 */
export function audienceOfKind(kind: ConversationKind): ThreadAudience {
  return kind === 'team' || kind === 'group' ? 'office' : 'client';
}

/* ------------------------------------------------------------- the counts */

/** What one chip prints, and whether it wears an unread dot. */
export interface ChipCount {
  /** The number in the brackets; `undefined` prints no brackets at all. */
  total?: number;
  /** The total is only a floor — the rows loaded so far — and reads "12+". */
  approximate: boolean;
  /** Unread threads in this chip. Drives the dot, and the tab badge for `all`. */
  unread: number;
}

/**
 * Unread, assembled from the two counters the server keeps — and they are not
 * interchangeable.
 *
 * `GET /conversations/counters` counts a thread unread from the conversation's
 * team-wide `unread` flag (`countsAsUnread` — `conversation-keys.ts:55`),
 * which is the **office's** inbox state. `GET /team/counters` counts the
 * caller's own `READ#` markers (`team-counters.service.ts:94-105`), over their
 * own thread and their groups. A technician opening their office thread moves
 * only their own marker and deliberately leaves the office's flag alone
 * (`team.controller.ts` — markRead), so believing the first number for the
 * office thread would light a badge that the technician's own reading can
 * never put out.
 *
 * So each thread is counted once, from whichever source actually knows this
 * viewer's read state: team and group from the team counters, everything else
 * from the inbox counters. `all` is the sum of the parts rather than
 * `unreadConversations`, which counts the office's flag on the office thread
 * too — that is what makes the chips, the rows and the tab badge agree by
 * construction instead of by luck.
 */
export function chipUnread(
  cat: InboxCategory,
  inbox: InboxCounters | undefined,
  team: TeamChatCounters | undefined,
): number {
  const byKind = inbox?.unreadByKind ?? {};
  const teamUnread = team?.unreadConversations ?? 0;
  const clients = byKind.client ?? 0;
  const requests = byKind.unknown ?? 0;
  switch (cat) {
    case 'team':
      return teamUnread;
    case 'clients':
      return clients;
    case 'requests':
      return requests;
    default:
      return teamUnread + clients + requests + (byKind.external ?? 0);
  }
}

/**
 * Total threads under one chip.
 *
 * Workiz prints the size of the category, not its unread — `Clients (0)` on
 * an account with no clients, never a running unread count — and marks unread
 * separately. The server's totals are believed only once `totalsRecountedAt`
 * says they have been rebuilt; a technician's always have been, because the
 * scoped branch counts every row it returns. Otherwise the list falls back to
 * what this phone has actually loaded, which is exact when there is no next
 * page and a floor ("12+") when there is — never a confident 0 over a list
 * that plainly has rows in it.
 */
export function chipCount(
  cat: InboxCategory,
  inbox: InboxCounters | undefined,
  team: TeamChatCounters | undefined,
  loaded: { count: number; complete: boolean } | undefined,
): ChipCount {
  const unread = chipUnread(cat, inbox, team);
  const total = chipTotal(cat, inbox);
  if (total !== undefined) return { total, approximate: false, unread };
  if (loaded) return { total: loaded.count, approximate: !loaded.complete, unread };
  return { approximate: false, unread };
}

function chipTotal(cat: InboxCategory, inbox: InboxCounters | undefined): number | undefined {
  if (!inbox || inbox.totalsRecountedAt === undefined) return undefined;
  const byKind = inbox.totalByKind ?? {};
  switch (cat) {
    case 'all':
      return inbox.totalConversations;
    case 'requests':
      return byKind.unknown ?? 0;
    case 'clients':
      return byKind.client ?? 0;
    case 'team':
      return (byKind.team ?? 0) + (byKind.group ?? 0);
    default:
      return undefined;
  }
}

/** `All (12)`, `All (12+)` while the number is a floor, or `All` when nothing is known. */
export function chipLabel(cat: InboxCategory, count: ChipCount): string {
  const label = CATEGORY_LABEL[cat];
  if (count.total === undefined) return label;
  return `${label} (${count.total}${count.approximate ? '+' : ''})`;
}

/** What a screen reader reads out — the dot is a colour and says nothing on its own. */
export function chipAccessibilityLabel(cat: InboxCategory, count: ChipCount): string {
  const parts = [chipLabel(cat, count)];
  if (count.unread) parts.push(`${count.unread} unread`);
  return parts.join(', ');
}

/**
 * The tab badge: the unread this technician's own reading puts out.
 *
 * Deliberately narrower than the `All` chip. A client thread's `unread` is the
 * office's team-wide flag, and nothing in this app clears it — the thread
 * screen does not mark a client conversation read on purpose, because that
 * call empties a dispatcher's badge on their behalf. Counting it on the tab
 * would put a number over Messages that survives being read, every day, and a
 * badge that cannot be put out is one a man stops looking at — including on
 * the day it is the office asking him something.
 *
 * The client's dot is not lost: it is on that row and in that chip, where it
 * sits next to the words that explain it.
 */
export function messagesBadgeCount(team: TeamChatCounters | undefined): number {
  return chipUnread('team', undefined, team);
}

/* ---------------------------------------------------------------- the rows */

/** One line of the list. */
export interface InboxRow {
  id: string;
  kind: ConversationKind;
  category: InboxCategory | undefined;
  audience: ThreadAudience;
  /** Who is on the other end. */
  title: string;
  /** The grey tag after the name — Workiz's "(Client)", "(Tech)". */
  tag: string;
  /** Up to 160 characters of the last message, as the server stores it. */
  preview: string;
  /** "12:10 PM" today, "Yesterday", "Mon, Sep 14". Empty on a thread with nothing in it. */
  time: string;
  unread: boolean;
  /** How many lines behind, when the source knows; 0 otherwise. */
  unreadCount: number;
  /** The job the thread last touched — the way into texting a client. */
  dealId?: string;
  /** Sorted on, never drawn. */
  activityAt: string;
}

/** The grey tag after a name; Workiz's own words (`apps/web/features/messaging/lib.ts:43-49`). */
export const KIND_TAG: Record<ConversationKind, string> = {
  client: 'Client',
  unknown: 'Unknown',
  team: 'Office',
  group: 'Group',
  external: 'External',
};

/** contactId → the client's name, taken from the jobs this phone already holds. */
export type PartyNames = ReadonlyMap<string, string>;

/**
 * Names for the client threads, built from the technician's own jobs.
 *
 * A conversation stores no contact name — the web resolves them live from CRM
 * — and a phone cannot open one request per row in a tunnel. It does not have
 * to: the set of client threads an `assigned_only` caller can see is built
 * from the contacts on their jobs (`conversation-scope.service.ts:113-124`),
 * and `GET /deals` hands this phone that same set of jobs in one query, with
 * the client's name on each. So the map is complete for exactly the rows that
 * can appear, costs no request, and survives with no signal.
 */
export function partyNames(
  deals: readonly { contactId?: string; clientName?: { firstName?: string; lastName?: string } }[],
): PartyNames {
  const names = new Map<string, string>();
  for (const deal of deals) {
    if (!deal.contactId || names.has(deal.contactId)) continue;
    const name = [deal.clientName?.firstName, deal.clientName?.lastName]
      .filter(Boolean)
      .join(' ')
      .trim();
    if (name) names.set(deal.contactId, name);
  }
  return names;
}

/**
 * The name on a row.
 *
 * The office is named "Office" whoever happens to be on shift — a technician
 * writes to the desk, not to Dana — matching the header the thread itself
 * draws (`audienceChrome`). Everyone else is their own name, then whatever
 * the import kept, then the number they write from. A viewer without
 * `contacts.view_numbers` gets no digits at all, and the honest word for a row
 * whose party this phone cannot name is the kind of party it is.
 */
export function rowTitle(c: InboxConversation, names: PartyNames): string {
  if (c.kind === 'team') return 'Office';
  if (c.kind === 'group') return c.name?.trim() || 'Group chat';
  if (c.partyKind === 'contact' && c.partyId) {
    const known = names.get(c.partyId);
    if (known) return known;
  }
  if (c.workizName?.trim()) return c.workizName.trim();
  if (!c.phonesMasked) {
    const address = c.addresses?.phones?.[0] ?? c.addresses?.emails?.[0];
    if (address) return address;
  }
  return c.kind === 'unknown' ? 'Unknown number' : 'Client';
}

/**
 * Is there something here this viewer has not read?
 *
 * The team rows carry the answer themselves — `viewerUnread` is computed from
 * the caller's own `READ#` marker (`team-counters.service.ts:108-115`) — so
 * where the team endpoint has spoken, it wins. A client thread has no
 * per-technician marker in this app at all: the technician's thread screen
 * deliberately does not mark one read, because that call clears the whole
 * office's badge. Its `unread` is therefore the office's, and it is still the
 * honest answer to "has the client written and has nobody dealt with it" —
 * which is the question a man in a van is asking.
 */
export function rowUnread(
  c: InboxConversation,
  viewer: Pick<TeamThread, 'viewerUnread' | 'viewerUnreadCount'> | undefined,
): { unread: boolean; unreadCount: number } {
  if (viewer) {
    return { unread: viewer.viewerUnread, unreadCount: viewer.viewerUnreadCount };
  }
  return { unread: Boolean(c.unread), unreadCount: c.unreadCount ?? 0 };
}

const sameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() &&
  a.getMonth() === b.getMonth() &&
  a.getDate() === b.getDate();

/**
 * The stamp at the end of a row: the clock for today, the word for yesterday,
 * the weekday and date for anything older. The same ladder the web list
 * climbs (`apps/web/features/messaging/lib.ts` — `formatDayLabel`), so a
 * dispatcher reading a row aloud and a technician looking at it see one thing.
 */
export function formatRowTime(iso: string | undefined, now = new Date()): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  if (sameDay(d, now)) {
    return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  }
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (sameDay(d, yesterday)) return 'Yesterday';
  if (d.getFullYear() === now.getFullYear()) {
    return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  }
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

/**
 * The rows of the list, newest activity first.
 *
 * The team threads are passed in separately because they carry something the
 * inbox route does not: this caller's own read state. Where a thread appears
 * in both, the inbox row is kept (it is the one the category counts were
 * computed over) and only the read state is taken from the team copy. A team
 * thread the inbox route never returned — which is what a technician without
 * `messages.view` has — is added, so the office thread is on the list even
 * when nothing else is.
 */
export function inboxRows(
  conversations: readonly InboxConversation[],
  teamThreads: readonly TeamThread[],
  names: PartyNames,
  now = new Date(),
): InboxRow[] {
  const viewerState = new Map<string, TeamThread>();
  for (const t of teamThreads) viewerState.set(t.id, t);

  const seen = new Set<string>();
  const rows: InboxRow[] = [];
  const push = (c: InboxConversation) => {
    if (seen.has(c.id)) return;
    seen.add(c.id);
    const activityAt = c.lastMessageAt ?? c.updatedAt ?? c.createdAt;
    rows.push({
      id: c.id,
      kind: c.kind,
      category: categoryOfKind(c.kind),
      audience: audienceOfKind(c.kind),
      title: rowTitle(c, names),
      tag: KIND_TAG[c.kind],
      preview: c.lastMessagePreview ?? '',
      time: formatRowTime(c.lastMessageAt, now),
      ...rowUnread(c, viewerState.get(c.id)),
      ...(c.lastDealId ? { dealId: c.lastDealId } : {}),
      activityAt,
    });
  };

  for (const c of conversations) push(c);
  for (const t of teamThreads) push(t);

  return rows.sort((a, b) => b.activityAt.localeCompare(a.activityAt));
}

/* ------------------------------------------------------------ the search */

/**
 * The search, over the rows this phone has.
 *
 * It matches the name, the last message and the digits of a number with the
 * punctuation taken out, so "5551234" finds "+1 (555) 123-4…". It cannot
 * reach the server: `GET /conversations` has no search parameter at all
 * (`list-conversations-query.dto.ts`), and inventing one would mean a box
 * that quietly returns less than it promises. What it searches is what is
 * loaded, which for a technician is their whole inbox.
 */
export function searchRows(rows: readonly InboxRow[], query: string): InboxRow[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...rows];
  const digits = q.replace(/\D/g, '');
  return rows.filter((row) => {
    const haystack = `${row.title} ${row.preview}`.toLowerCase();
    if (haystack.includes(q)) return true;
    if (!digits) return false;
    return row.title.replace(/\D/g, '').includes(digits);
  });
}

/** The list as drawn: one chip's rows, narrowed by the search box. */
export function visibleRows(
  rows: readonly InboxRow[],
  category: InboxCategory,
  query: string,
): InboxRow[] {
  return searchRows(
    rows.filter((row) => inCategory(row.kind, category)),
    query,
  );
}

/* ---------------------------------------------------- the way into texting */

/** A job of this technician's, as the day list already holds it. */
export interface OwnDeal {
  id: string;
  contactId?: string;
}

/**
 * The job a client thread opened from the list can be texted from — or
 * nothing, in which case no such offer is made.
 *
 * `POST /messages` authorises a text against the job it names
 * (`send.service.ts:942-950`), and the only job a conversation carries is
 * `lastDealId`: the job the **thread** last touched. For a client with more
 * than one property — a landlord, a letting agent, a shop with three branches
 * — that is very often a job this technician is not on, and the button would
 * open a screen the server refuses. So the offer is made against one of his
 * own jobs with that client: the thread's own job when he is on it, otherwise
 * the first of his that belongs to the same contact.
 */
export function textableDealId(
  conversation: Pick<InboxConversation, 'partyKind' | 'partyId' | 'lastDealId'>,
  deals: readonly OwnDeal[],
): string | undefined {
  if (conversation.partyKind !== 'contact' || !conversation.partyId) return undefined;
  const mine = deals.filter((deal) => deal.contactId === conversation.partyId);
  if (!mine.length) return undefined;
  const thread = conversation.lastDealId;
  if (thread && mine.some((deal) => deal.id === thread)) return thread;
  return mine[0]!.id;
}

/* --------------------------------------------------------- what may be seen */

/**
 * What the list is allowed to show this account, and what it must say about
 * the rest.
 *
 * The two halves of the screen are read with two different permissions:
 * `GET /conversations` needs `messages.view`, `GET /team/conversations` needs
 * `team_chat.view` (`conversations.controller.ts:29`, `team.controller.ts:27`).
 * A technician's role may carry one without the other, and under
 * `assigned_only` even a caller who has both is handed only the threads of
 * the jobs they are on plus their own — never the company's inbox.
 *
 * A refusal must therefore never be drawn as an empty list. "No results
 * found" over a 403 tells a man there are no messages when what happened is
 * that he was not allowed to ask.
 */
export interface InboxAccess {
  /** The whole list was refused: nothing loaded and nothing to fall back on. */
  blocked: boolean;
  /**
   * Client and Requests threads were refused, but the office thread loaded.
   * The list still works — it is just the office thread and says so.
   */
  clientsRefused: boolean;
  /** One line under the chips, when something is missing from the list. */
  notice?: string;
}

export function inboxAccess(
  inboxError: unknown,
  teamError: unknown,
  hasTeamRows: boolean,
  /**
   * The office thread is still on its way. The two halves are two requests and
   * the refusal comes back first, so without this a technician who has an
   * office thread gets "Not your inbox" thrown up over the screen for as long
   * as the second request takes.
   */
  teamPending = false,
): InboxAccess {
  const inboxForbidden = isForbidden(inboxError);
  const teamForbidden = isForbidden(teamError);

  if (inboxForbidden && teamPending && !teamForbidden) {
    return { blocked: false, clientsRefused: true };
  }
  if (inboxForbidden && (teamForbidden || !hasTeamRows)) {
    return { blocked: true, clientsRefused: true };
  }
  if (inboxForbidden) {
    return {
      blocked: false,
      clientsRefused: true,
      notice:
        'This account can only open the office thread. Client conversations are not shared with it — ask dispatch to check your role.',
    };
  }
  return { blocked: false, clientsRefused: false };
}

function isForbidden(error: unknown): boolean {
  return error instanceof ApiError && (error.status === 403 || error.status === 401);
}

/** Why the list would not load, in words a technician can act on. */
export function describeInboxError(error: unknown): { title: string; body: string } {
  if (error instanceof ApiError && error.status === 0) {
    return {
      title: 'No signal',
      body: 'This is the last list this phone downloaded. It refreshes as soon as there is a connection.',
    };
  }
  if (isForbidden(error)) {
    return {
      title: 'Not your inbox',
      body: 'This account is not allowed to read messages. Ask dispatch to check your role.',
    };
  }
  return {
    title: 'Could not load your messages',
    body:
      error instanceof ApiError
        ? error.message
        : 'Something went wrong on the way to the server.',
  };
}

/**
 * The empty state. Workiz says exactly `No results found` on this screen and
 * nothing else (§5); a technician who has never been written to needs a
 * sentence more than that, and a search that found nothing needs Workiz's.
 */
export function emptyStateFor(
  category: InboxCategory,
  searching: boolean,
): { title: string; body?: string } {
  if (searching) {
    return {
      title: 'No results found',
      body: 'Searching the conversations already on this phone.',
    };
  }
  switch (category) {
    case 'clients':
      return {
        title: 'No results found',
        body: 'No client on your jobs has been texted yet. Open a job and use Text to start one.',
      };
    case 'team':
      return {
        title: 'No results found',
        body: 'Nothing from the office yet. Open this thread to write to them first.',
      };
    case 'requests':
      return { title: 'No results found' };
    default:
      return {
        title: 'No results found',
        body: 'Messages from the office and from the clients on your jobs appear here.',
      };
  }
}
