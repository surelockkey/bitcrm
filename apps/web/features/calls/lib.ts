/** Shared call-domain helpers: types, status presentation, formatters. */

import { formatIntl } from "@/lib/phone";

export type CallStatus =
  | "queued"
  | "initiated"
  | "ringing"
  | "in-progress"
  | "completed"
  | "busy"
  | "no-answer"
  | "failed"
  | "canceled";

export type ParticipantRole = "caller" | "answered" | "listened" | "joined";

export interface CallParticipant {
  userId: string;
  role: ParticipantRole;
  at: string;
  /** Display name resolved by the backend. */
  name?: string;
  /** Their system role, resolved by the backend. */
  roleId?: string;
}

export interface CallRecord {
  callSid: string;
  direction?: "inbound" | "outbound";
  from?: string;
  to?: string;
  status?: CallStatus;
  agentId?: string;
  agentName?: string;
  agentRoleId?: string;
  /**
   * Who was on each side, resolved (and, once the call has ended, frozen) by
   * the backend. This is the single answer the UI renders — the precedence
   * between softphone participant, personal number and CRM record lives
   * server-side in one place.
   */
  fromParty?: CallParty;
  toParty?: CallParty;
  /** The job this call was linked to, if any. */
  dealId?: string;
  dealLinkedBy?: string;
  dealLinkedAt?: string;
  /** How the party was decided — a manual choice is never re-derived. */
  partySource?: "auto" | "manual";
  durationSeconds?: number;
  startedAt: string;
  updatedAt: string;
  answeredAt?: string;
  endedAt?: string;
  conferenceName?: string;
  conferenceSid?: string;
  recordingSid?: string;
  recordingDurationSeconds?: number;
  childSids?: string[];
  participants?: CallParticipant[];
  internalLegOf?: string;
}

export const PARTICIPANT_ROLE_LABEL: Record<ParticipantRole, string> = {
  caller: "Called",
  answered: "Answered",
  listened: "Listened in",
  joined: "Joined the call",
};

export interface CallsFilter {
  direction?: string;
  status?: string;
  agentId?: string;
  number?: string;
  /** Any of these numbers, either side — one client's whole phone list. */
  numbers?: string[];
  dateFrom?: string;
  dateTo?: string;
}

export const LIVE_STATUSES: CallStatus[] = [
  "queued",
  "initiated",
  "ringing",
  "in-progress",
];

export function isLive(call: Pick<CallRecord, "status">): boolean {
  return !!call.status && LIVE_STATUSES.includes(call.status);
}

export const STATUS_LABEL: Record<CallStatus, string> = {
  queued: "Queued",
  initiated: "Starting…",
  ringing: "Ringing",
  "in-progress": "In progress",
  completed: "Completed",
  busy: "Busy",
  "no-answer": "No answer",
  failed: "Failed",
  canceled: "Canceled",
};

/** Badge tint per status: live = emerald, clean end = neutral, misses = amber/red. */
export function statusTone(
  status?: CallStatus,
): "live" | "neutral" | "warn" | "error" {
  if (!status) return "neutral";
  if (LIVE_STATUSES.includes(status)) return "live";
  if (status === "completed") return "neutral";
  if (status === "failed") return "error";
  return "warn"; // busy / no-answer / canceled
}

/** Seconds → "m:ss" under an hour, "h:mm:ss" above. */
export function formatDuration(seconds?: number): string {
  if (seconds === undefined || seconds === null || Number.isNaN(seconds)) {
    return "—";
  }
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const rest = s % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(rest).padStart(2, "0")}`
    : `${m}:${String(rest).padStart(2, "0")}`;
}

/** ISO → "Aug 5, 2:41 PM" (adds the year when it isn't the current one). */
export function formatCallTime(iso?: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
    hour: "numeric",
    minute: "2-digit",
  });
}

/** The legacy `client:<userId>` endpoints — an agent's browser leg, not a number. */
export function isClientEndpoint(value?: string): boolean {
  return !!value && value.startsWith("client:");
}

/**
 * A call endpoint for display: E.164 numbers get international grouping
 * (`+380 95 860 1427` — NOT the national format, whose leading 0 reads like
 * an extra digit); `client:<userId>` endpoints (an agent's browser leg —
 * legacy pre-conference records) render as "Agent"; blanks dash out.
 */
export function formatEndpoint(value?: string): string {
  if (!value) return "—";
  if (isClientEndpoint(value)) return "Agent";
  return formatIntl(value) || value;
}

/**
 * The endpoint of the far side, for places that need a number rather than an
 * identity — dialling back, or the softphone's caller-id label.
 */
export function otherPartyNumber(
  call: Pick<CallRecord, "direction" | "from" | "to">,
): string | undefined {
  const candidate = call.direction === "inbound" ? call.from : call.to;
  // Legacy records sometimes carry client: endpoints — prefer the other side.
  if (candidate && !isClientEndpoint(candidate)) return candidate;
  const fallback = call.direction === "inbound" ? call.to : call.from;
  return fallback && !isClientEndpoint(fallback) ? fallback : candidate;
}

/**
 * One side of a call, exactly as the backend resolved it: one of our own
 * people, a client (person or company), or a number nobody has claimed yet.
 *
 * The precedence that picks between those lives server-side — see
 * telephony's `party-resolver`. The UI does not re-derive it, because two
 * implementations of the same rules is how they end up disagreeing.
 */
export interface CallParty {
  kind: "user" | "contact" | "company" | "unknown";
  /** Identity within `kind`; absent for `unknown`. */
  id?: string;
  /** The user's system role, for labelling them as one of ours. */
  roleId?: string;
  /**
   * True when a teammate was reached on their own phone rather than through
   * the softphone — i.e. our system dialled their personal number.
   */
  personal?: boolean;
  /** Display name; absent for `unknown`. */
  name?: string;
  /** The raw endpoint, E.164 or a legacy `client:` leg. */
  number?: string;
}

/**
 * The party on one side of a call, ready to render. Falls back to an unknown
 * party carrying just the number — which is what the "Add client" shortcut
 * needs, and what an un-enriched record (CRM unreachable) looks like.
 */
export function callParty(call: CallRecord, side: "from" | "to"): CallParty {
  const number = side === "from" ? call.from : call.to;
  const party = side === "from" ? call.fromParty : call.toParty;
  if (!party) return { kind: "unknown", number };
  return { ...party, number: party.number ?? number };
}

/** True when both sides are our own people — an internal call. */
export function isInternalCall(call: CallRecord): boolean {
  return call.fromParty?.kind === "user" && call.toParty?.kind === "user";
}

/**
 * The party that isn't us — whoever the call was actually with. Both sides
 * being ours means an internal call, where the answerer is the far end.
 */
export function counterparty(call: CallRecord): CallParty {
  const from = callParty(call, "from");
  return from.kind === "user" ? callParty(call, "to") : from;
}

/** Filter → querystring params for GET /calls (drops empty values). */
export function filterToParams(
  filter: CallsFilter,
  cursor?: string,
  limit?: number,
): URLSearchParams {
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(filter)) {
    if (Array.isArray(value)) {
      if (value.length) qs.set(key, value.join(","));
    } else if (value) {
      qs.set(key, value);
    }
  }
  if (cursor) qs.set("cursor", cursor);
  if (limit) qs.set("limit", String(limit));
  return qs;
}
