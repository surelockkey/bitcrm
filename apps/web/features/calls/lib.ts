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
}

export interface CallRecord {
  callSid: string;
  direction?: "inbound" | "outbound";
  from?: string;
  to?: string;
  status?: CallStatus;
  agentId?: string;
  agentName?: string;
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

/** The customer-facing party of a call (the non-agent side). */
export function otherParty(
  call: Pick<CallRecord, "direction" | "from" | "to">,
): string | undefined {
  const candidate = call.direction === "inbound" ? call.from : call.to;
  // Legacy records sometimes carry client: endpoints — prefer the other side.
  if (candidate && !candidate.startsWith("client:")) return candidate;
  const fallback = call.direction === "inbound" ? call.to : call.from;
  return fallback && !fallback.startsWith("client:") ? fallback : candidate;
}

/** A user id with no resolved name still has to render as something. */
function shortId(userId: string): string {
  return `${userId.slice(0, 8)}…`;
}

function participantLabel(p: CallParticipant): string {
  return p.name ?? shortId(p.userId);
}

/** One side of a call: the system user on it (if any) plus the endpoint. */
export interface CallParty {
  /** Set only when this side is one of our users — links to their profile. */
  userId?: string;
  /** That user's display name (or a shortened id when unresolved). */
  label?: string;
  /** The raw endpoint, E.164 or a legacy `client:` leg. */
  number?: string;
}

/**
 * Who is on the `from` / `to` side of a call. Outbound calls have our user on
 * `from` (whoever dialled), inbound ones have them on `to` (whoever answered),
 * and an internal call — our number to our number — has a user on both sides.
 * The stored agent is the fallback when no participant was recorded (e.g. a
 * call nobody picked up still points at the agent it rang).
 */
export function callParty(call: CallRecord, side: "from" | "to"): CallParty {
  const number = side === "from" ? call.from : call.to;
  const caller = call.participants?.find((p) => p.role === "caller");
  const answered = call.participants?.find((p) => p.role === "answered");
  const agent: CallParty | undefined = call.agentId
    ? { userId: call.agentId, label: call.agentName ?? shortId(call.agentId) }
    : undefined;
  const of = (p: CallParticipant): CallParty => ({
    userId: p.userId,
    label: participantLabel(p),
  });

  let user: CallParty | undefined;
  if (side === "from") {
    // Inbound calls come from outside — no user on this side.
    if (call.direction !== "inbound") user = caller ? of(caller) : agent;
  } else if (call.direction === "inbound") {
    user = answered ? of(answered) : agent;
  } else if (answered && answered.userId !== caller?.userId) {
    // Outbound to one of our own numbers — the internal call's receiving user.
    user = of(answered);
  }

  return { ...user, number };
}

/**
 * The system user(s) behind a call, for the table's User column:
 * outbound → who called; inbound → who answered; internal (our number to our
 * number) → "caller → answerer". Falls back to the stored agent.
 */
export function callUsers(call: CallRecord): string {
  const caller = call.participants?.find((p) => p.role === "caller");
  const answered = call.participants?.find((p) => p.role === "answered");

  if (caller && answered && caller.userId !== answered.userId) {
    return `${participantLabel(caller)} → ${participantLabel(answered)}`;
  }
  const main = caller ?? answered;
  if (main) return participantLabel(main);
  if (call.agentName) return call.agentName;
  if (call.agentId) return `${call.agentId.slice(0, 8)}…`;
  return "—";
}

/** Filter → querystring params for GET /calls (drops empty values). */
export function filterToParams(
  filter: CallsFilter,
  cursor?: string,
  limit?: number,
): URLSearchParams {
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(filter)) {
    if (value) qs.set(key, value);
  }
  if (cursor) qs.set("cursor", cursor);
  if (limit) qs.set("limit", String(limit));
  return qs;
}
