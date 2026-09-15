import type {
  Conversation,
  ConversationKind,
  InboxCounters,
  MessageAttachment,
  MessageStatus,
  PaginatedResponse,
} from "@bitcrm/types";
import { formatPhone } from "@/lib/phone";
import type {
  ConversationListFilter,
  FeedMessage,
  InboxConversation,
  InboxView,
} from "./api";

/* --------------------------------------------------------------- labels */

export const VIEW_LABEL: Record<InboxView, string> = {
  all: "All",
  unread: "Unread",
  flagged: "Flagged",
  archived: "Archived",
  mine: "Mine",
};

/** The category chips under the tabs (Workiz Clients / Team / Unknown). */
export const KIND_FILTERS: { value: ConversationKind; label: string }[] = [
  { value: "client", label: "Clients" },
  { value: "team", label: "Team" },
  { value: "unknown", label: "Unknown" },
];

export const KIND_LABEL: Record<ConversationKind, string> = {
  client: "Client",
  unknown: "Unknown",
  team: "Team",
  group: "Group",
  external: "External",
};

/** The grey tag after a name in the Workiz list and thread header: "(Client)", "(Tech)", "(Unknown)". */
export const KIND_TAG: Record<ConversationKind, string> = {
  client: "Client",
  unknown: "Unknown",
  team: "Tech",
  group: "Group",
  external: "External",
};

/* ----------------------------------------------------------- categories */

/** What the list is showing: the category (view + kind) and the search text. */
export interface ListState {
  view: InboxView;
  kind?: ConversationKind;
  search: string;
}

/** The Workiz Inbox categories, in the order the left column lists them. */
export type InboxCategory = "all" | "requests" | "clients" | "team" | "archived";

export const INBOX_CATEGORIES: { value: InboxCategory; label: string }[] = [
  { value: "all", label: "All" },
  { value: "requests", label: "Requests" },
  { value: "clients", label: "Clients" },
  { value: "team", label: "Team" },
  { value: "archived", label: "Archived" },
];

/**
 * Which category a list state sits in. Workiz's Requests are enquiries from
 * people not yet in CRM; the nearest thing here is the `unknown` kind (a
 * number or email that resolved to nobody). Group threads sit under Team.
 */
export function categoryOf(s: { view: InboxView; kind?: ConversationKind }): InboxCategory {
  if (s.view === "archived") return "archived";
  switch (s.kind) {
    case "unknown":
      return "requests";
    case "client":
      return "clients";
    case "team":
    case "group":
      return "team";
    default:
      return "all";
  }
}

/** The list state a category selects; an Unread / Flagged / Mine filter survives the switch. */
export function categoryState(
  cat: InboxCategory,
  current: { view: InboxView },
): { view: InboxView; kind?: ConversationKind } {
  if (cat === "archived") return { view: "archived", kind: undefined };
  const view: InboxView = current.view === "archived" ? "all" : current.view;
  switch (cat) {
    case "requests":
      return { view, kind: "unknown" };
    case "clients":
      return { view, kind: "client" };
    case "team":
      return { view, kind: "team" };
    default:
      return { view, kind: undefined };
  }
}

/** Whether a loaded row belongs to a category (client-side narrowing under a filter view). */
export function conversationInCategory(c: InboxConversation, cat: InboxCategory): boolean {
  switch (cat) {
    case "archived":
      return c.state === "archived";
    case "requests":
      return c.kind === "unknown";
    case "clients":
      return c.kind === "client";
    case "team":
      return c.kind === "team" || c.kind === "group";
    default:
      return true;
  }
}

/**
 * The number by a category's label. The API keeps unread counters only (no
 * totals), so this is the unread-conversation count; Archived has none.
 */
export function categoryUnread(cat: InboxCategory, counters: InboxCounters | undefined): number | undefined {
  if (!counters) return undefined;
  const byKind = counters.unreadByKind ?? {};
  switch (cat) {
    case "all":
      return counters.unreadConversations;
    case "requests":
      return byKind.unknown ?? 0;
    case "clients":
      return byKind.client ?? 0;
    case "team":
      return (byKind.team ?? 0) + (byKind.group ?? 0);
    default:
      return undefined;
  }
}

export const STATUS_LABEL: Record<MessageStatus, string> = {
  received: "Received",
  queued: "Queued",
  sending: "Sending",
  sent: "Sent",
  delivered: "Delivered",
  undelivered: "Undelivered",
  failed: "Failed",
  read: "Read",
  opened: "Opened",
  clicked: "Clicked",
  canceled: "Canceled",
};

/** Which tick an outbound bubble shows. */
export type StatusTick = "pending" | "sent" | "delivered" | "read" | "error";

export function statusTick(status: MessageStatus): StatusTick {
  switch (status) {
    case "queued":
    case "sending":
      return "pending";
    case "sent":
      return "sent";
    case "delivered":
      return "delivered";
    case "read":
    case "opened":
    case "clicked":
      return "read";
    case "undelivered":
    case "failed":
    case "canceled":
      return "error";
    default:
      return "sent";
  }
}

export const isFailedStatus = (status: MessageStatus): boolean =>
  statusTick(status) === "error";

/**
 * A short reason for the Twilio codes a service-business inbox actually
 * meets. Anything else shows the carrier's own words, or the bare code.
 */
export const ERROR_CODE_TEXT: Record<string, string> = {
  "21408": "Texting this country is not enabled on the account",
  "21610": "This number opted out of texts (STOP)",
  "21211": "Invalid phone number",
  "21614": "Not a mobile number",
  "30034": "Sender number is not registered for A2P 10DLC",
  "30003": "Phone unreachable or switched off",
  "30007": "Filtered by the carrier as spam",
};

/** Why an outbound message did not arrive: the carrier's words, else a known code's text, else the code. */
export function errorText(error: { errorCode?: string; errorMessage?: string }): string {
  if (error.errorMessage) return error.errorMessage;
  if (error.errorCode) return ERROR_CODE_TEXT[error.errorCode] ?? `Not delivered (code ${error.errorCode})`;
  return "Not delivered";
}

/**
 * The words under an outbound bubble — Workiz's "Message received"; a
 * failure reads "Failed · <why>" from the message's error fields.
 */
export function statusText(
  status: MessageStatus,
  error?: { errorCode?: string; errorMessage?: string },
): string {
  switch (statusTick(status)) {
    case "pending":
      return "Sending…";
    case "sent":
      return "Message sent";
    case "delivered":
      return "Message received";
    case "read":
      return "Message read";
    default:
      return `Failed · ${errorText(error ?? {})}`;
  }
}

/** The channel word after the stamp: Workiz says "Text" for SMS and MMS alike. */
export function channelLabel(channel: string): string {
  switch (channel) {
    case "email":
      return "Email";
    case "in_app":
      return "App";
    case "note":
      return "Note";
    default:
      return "Text";
  }
}

/* ------------------------------------------------------------ identity */

/** Sort key of a message (`MSG#<createdAt>#<id>`) — what the read marker stores. */
export const messageSk = (m: Pick<FeedMessage, "createdAt" | "id">): string =>
  `MSG#${m.createdAt}#${m.id}`;

/** Names resolved from CRM / the user directory, keyed by id. */
export interface PartyNames {
  contacts: Map<string, string>;
  companies: Map<string, string>;
  users: Map<string, string>;
}

export const EMPTY_PARTY_NAMES: PartyNames = {
  contacts: new Map(),
  companies: new Map(),
  users: new Map(),
};

/** The party's phone, formatted, or a masked placeholder. */
export function conversationAddress(c: InboxConversation): string | undefined {
  const phone = c.addresses?.phones?.[0];
  if (phone) return formatPhone(phone);
  const email = c.addresses?.emails?.[0];
  if (email) return email;
  return undefined;
}

/**
 * What the list row and the thread header call the other side. Contact,
 * company and employee names come from their own records (the conversation
 * never stores them); an unknown number is the number, or "Unknown number"
 * when the viewer cannot see digits.
 */
export function conversationTitle(c: InboxConversation, names: PartyNames): string {
  if (c.partyId) {
    const resolved =
      c.partyKind === "contact"
        ? names.contacts.get(c.partyId)
        : c.partyKind === "company"
          ? names.companies.get(c.partyId)
          : c.partyKind === "user"
            ? names.users.get(c.partyId)
            : undefined;
    if (resolved) return resolved;
  }
  if (c.workizName) return c.workizName;
  const address = conversationAddress(c);
  if (address) return address;
  if (c.phonesMasked) return "Unknown number";
  if (c.kind === "group") return "Group chat";
  return "Conversation";
}

/** Where the party's own record lives, when it has one. */
export function partyHref(c: Pick<Conversation, "partyKind" | "partyId">): string | undefined {
  if (!c.partyId) return undefined;
  switch (c.partyKind) {
    case "contact":
      return `/contacts/${c.partyId}`;
    case "company":
      return `/companies/${c.partyId}`;
    case "user":
      return `/technicians/${c.partyId}`;
    default:
      return undefined;
  }
}

/** The round avatar's letter, as Workiz draws it: the title's first character, verbatim ("J", "(", "8", "a"). */
export function avatarInitial(title: string): string {
  const first = [...title.trim()][0];
  return first ?? "#";
}

export function initialsOf(title: string): string {
  // A bare number gets a glyph, not the first two digits of an area code.
  if (!/\p{L}/u.test(title)) return "#";
  const words = title.replace(/[^\p{L}\p{N} ]/gu, "").trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "#";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}

/* ----------------------------------------------------------------- time */

const sameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

const dayKey = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** "Today", "Yesterday", "Mon, Sep 14", or "Sep 14, 2025" for older years. */
export function formatDayLabel(iso: string, now = new Date()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  if (sameDay(d, now)) return "Today";
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (sameDay(d, yesterday)) return "Yesterday";
  if (d.getFullYear() === now.getFullYear()) {
    return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  }
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function formatMessageTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

/** The day chip in the thread, spelled as Workiz spells it: "Tuesday,September 15 2026". */
export function formatDayChip(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const weekday = d.toLocaleDateString("en-US", { weekday: "long" });
  const month = d.toLocaleDateString("en-US", { month: "long" });
  return `${weekday},${month} ${d.getDate()} ${d.getFullYear()}`;
}

/** The stamp under a bubble: "Sep 15 2026 12:10 PM". */
export function formatMessageStamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const month = d.toLocaleDateString("en-US", { month: "short" });
  return `${month} ${d.getDate()} ${d.getFullYear()} ${formatMessageTime(iso)}`;
}

/** List-row timestamp: time today, weekday this week, else a short date. */
export function formatListTime(iso: string | undefined, now = new Date()): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  if (sameDay(d, now)) return formatMessageTime(iso);
  const diffDays = (now.getTime() - d.getTime()) / 86_400_000;
  if (diffDays < 6) return d.toLocaleDateString("en-US", { weekday: "short" });
  if (d.getFullYear() === now.getFullYear()) {
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  }
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "2-digit" });
}

/* ------------------------------------------------------------ the feed */

/** Newest first, one entry per id — pages can overlap after a live refetch. */
export function flattenFeed(pages: PaginatedResponse<FeedMessage>[] | undefined): FeedMessage[] {
  const seen = new Set<string>();
  const out: FeedMessage[] = [];
  for (const page of pages ?? []) {
    for (const m of page.data) {
      if (seen.has(m.id)) continue;
      seen.add(m.id);
      out.push(m);
    }
  }
  return out.sort(byCreatedAtDesc);
}

export const byCreatedAtDesc = (a: FeedMessage, b: FeedMessage): number =>
  a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0;

export interface DayGroup {
  key: string;
  label: string;
  /** Oldest first, for reading top to bottom. */
  messages: FeedMessage[];
}

/** Oldest day first, oldest message first — the thread reads downwards; labelled like Workiz's day chips. */
export function groupByDay(newestFirst: FeedMessage[]): DayGroup[] {
  const groups: DayGroup[] = [];
  const byKey = new Map<string, DayGroup>();
  for (let i = newestFirst.length - 1; i >= 0; i--) {
    const m = newestFirst[i];
    const d = new Date(m.createdAt);
    const key = Number.isNaN(d.getTime()) ? "unknown" : dayKey(d);
    let group = byKey.get(key);
    if (!group) {
      group = { key, label: formatDayChip(m.createdAt), messages: [] };
      byKey.set(key, group);
      groups.push(group);
    }
    group.messages.push(m);
  }
  return groups;
}

/** Insert or replace a message, keeping pages newest-first and ids unique. */
export function upsertMessageInPages(
  pages: PaginatedResponse<FeedMessage>[],
  message: FeedMessage,
): PaginatedResponse<FeedMessage>[] {
  const existsSomewhere = pages.some((p) => p.data.some((m) => m.id === message.id));
  if (existsSomewhere) {
    return pages.map((p) => ({
      ...p,
      data: p.data.map((m) => (m.id === message.id ? { ...m, ...message } : m)),
    }));
  }
  if (pages.length === 0) {
    return [{ success: true, data: [message], pagination: { nextCursor: undefined, count: 1 } }];
  }
  const [first, ...rest] = pages;
  return [
    { ...first, data: [message, ...first.data].sort(byCreatedAtDesc) },
    ...rest,
  ];
}

/**
 * The composer's optimistic line carries the `clientMessageId` as its id
 * until the 202 answers with the real message. Both the placeholder and
 * any copy of the real message the stream delivered first are dropped.
 */
export function replacePendingMessage(
  pages: PaginatedResponse<FeedMessage>[],
  clientMessageId: string,
  real: FeedMessage,
): PaginatedResponse<FeedMessage>[] {
  const stripped = pages.map((p) => ({
    ...p,
    data: p.data.filter((m) => m.id !== clientMessageId && m.id !== real.id),
  }));
  return upsertMessageInPages(stripped, real);
}

export function patchMessageInPages(
  pages: PaginatedResponse<FeedMessage>[],
  id: string,
  patch: Partial<FeedMessage>,
): PaginatedResponse<FeedMessage>[] {
  return pages.map((p) => ({
    ...p,
    data: p.data.map((m) => (m.id === id ? { ...m, ...patch } : m)),
  }));
}

/** Drop a line — a placeholder whose request was refused. */
export function removeMessageFromPages(
  pages: PaginatedResponse<FeedMessage>[],
  id: string,
): PaginatedResponse<FeedMessage>[] {
  return pages.map((p) => ({ ...p, data: p.data.filter((m) => m.id !== id) }));
}

/* ------------------------------------------------------------ the list */

/** Whether a conversation belongs on the tab a list query is showing. */
export function matchesFilter(
  c: InboxConversation,
  filter: ConversationListFilter,
  meId?: string,
): boolean {
  switch (filter.view) {
    case "archived":
      return c.state === "archived";
    case "flagged":
      return c.flagged;
    case "unread":
      return c.state !== "archived" && c.unread;
    case "mine":
      return c.state !== "archived" && !!meId && c.assignedUserId === meId;
    case "all":
    default:
      if (c.state === "archived") return false;
      if (filter.kind && c.kind !== filter.kind) return false;
      if (filter.categoryId && c.categoryId !== filter.categoryId) return false;
      return true;
  }
}

export const byLastMessageDesc = (a: Conversation, b: Conversation): number => {
  const x = a.lastMessageAt ?? a.updatedAt ?? "";
  const y = b.lastMessageAt ?? b.updatedAt ?? "";
  return x < y ? 1 : x > y ? -1 : 0;
};

/**
 * Apply a fresh conversation row to a list's pages: drop every copy, then
 * put it back on page one if it still belongs on this tab. Sorting by last
 * activity is what moves a thread to the top when a message arrives.
 */
export function upsertConversationInPages(
  pages: PaginatedResponse<InboxConversation>[],
  conversation: InboxConversation,
  filter: ConversationListFilter,
  meId?: string,
): PaginatedResponse<InboxConversation>[] {
  const stripped = pages.map((p) => ({
    ...p,
    data: p.data.filter((c) => c.id !== conversation.id),
  }));
  if (!matchesFilter(conversation, filter, meId)) return stripped;
  if (stripped.length === 0) {
    return [{ success: true, data: [conversation], pagination: { nextCursor: undefined, count: 1 } }];
  }
  const [first, ...rest] = stripped;
  return [{ ...first, data: [conversation, ...first.data].sort(byLastMessageDesc) }, ...rest];
}

export function flattenConversations(
  pages: PaginatedResponse<InboxConversation>[] | undefined,
): InboxConversation[] {
  const seen = new Set<string>();
  const out: InboxConversation[] = [];
  for (const page of pages ?? []) {
    for (const c of page.data) {
      if (seen.has(c.id)) continue;
      seen.add(c.id);
      out.push(c);
    }
  }
  return out;
}

/* --------------------------------------------------------------- search */

const digits = (s: string) => s.replace(/\D/g, "");

/** A query with at least seven digits is a number, not a name. */
export const looksLikePhoneQuery = (q: string): boolean => digits(q).length >= 7;

/** Client-side match over what is already loaded: title, preview, address. */
export function matchesSearch(c: InboxConversation, title: string, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  if (title.toLowerCase().includes(q)) return true;
  if (c.lastMessagePreview?.toLowerCase().includes(q)) return true;
  const qd = digits(q);
  if (qd.length >= 3) {
    if (c.addresses?.phones?.some((p) => digits(p).includes(qd))) return true;
  }
  if (c.addresses?.emails?.some((e) => e.toLowerCase().includes(q))) return true;
  return false;
}

/* ---------------------------------------------------------- attachments */

export const isImageAttachment = (a: MessageAttachment): boolean =>
  a.contentType.startsWith("image/");

export function formatBytes(n?: number): string {
  if (!n) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/** Twilio's ceiling for one MMS: 10 files, 5 MB together (design §4.6). */
export const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;

/* ------------------------------------------------------------- composer */

/** The idempotency key of one send — minted here, echoed by the server. */
export function newClientMessageId(): string {
  const c = globalThis.crypto;
  if (c?.randomUUID) return c.randomUUID();
  // RFC 4122 v4 from getRandomValues, for the odd runtime without randomUUID.
  const bytes = new Uint8Array(16);
  c.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Insert text at a selection, returning the new value and where the caret lands. */
export function insertAtCursor(
  value: string,
  insert: string,
  selectionStart: number,
  selectionEnd = selectionStart,
): { value: string; caret: number } {
  const start = Math.max(0, Math.min(selectionStart, value.length));
  const end = Math.max(start, Math.min(selectionEnd, value.length));
  return {
    value: value.slice(0, start) + insert + value.slice(end),
    caret: start + insert.length,
  };
}

/** `{{first_name}}`-style placeholders that still need the server to fill them. */
export const hasShortCodes = (text: string): boolean => /\{\{\s*[^{}]+\s*\}\}/.test(text);

/** A short sentence for the toast / banner when a send fails. */
export function describeSendError(status: number | undefined, message: string): string {
  if (status === 422) return "This number has opted out of texts (STOP). They need to text START first.";
  if (status === 501) return "Only SMS can be sent right now.";
  return message;
}

/** The toast when a resend is refused: 409 means the line is not in a failed state (any more). */
export function describeResendError(status: number | undefined, message: string): string {
  if (status === 409) return "Only failed messages can be resent";
  return describeSendError(status, message);
}
