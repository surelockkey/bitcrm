import { http } from "@/lib/api/http";

export interface VoiceToken {
  token: string;
  identity: string;
  expiresAt: number;
}

/** Mint a Twilio Voice access token for the browser device. */
export function fetchVoiceToken(): Promise<VoiceToken> {
  return http.post<VoiceToken>("/telephony/token");
}

/** Mark the current agent online (with heartbeat) or offline for inbound routing. */
export function setPresence(online: boolean): Promise<unknown> {
  return http.post("/telephony/presence", { online });
}

export interface ContactMatch {
  id: string;
  firstName?: string;
  lastName?: string;
  companyName?: string;
}

/**
 * Screen-pop: who is this number? Resolved by telephony through the same
 * precedence the call log uses — one of our own people on their personal
 * number, then a CRM contact, then a company main line — so the name that
 * flashes on an incoming call matches the name the call log will show.
 * Best-effort: null on any error.
 */
export interface IdentifiedParty {
  kind: "user" | "contact" | "company";
  id: string;
  name?: string;
  personal?: boolean;
}

/** A teammate a live call can be handed to, or pulled onto. */
export interface TransferTarget {
  id: string;
  name: string;
  roleId?: string;
  /** Their own number, when set — the route that works when they're away. */
  phone?: string;
  softphoneOnline: boolean;
}

export const listTransferTargets = (): Promise<TransferTarget[]> =>
  http.get<TransferTarget[]>("/telephony/presence/online");

/**
 * Bring a teammate onto a live call. `handOver` releases the caller's own leg
 * first, so they can hang up without ending the call — that's a transfer.
 * Without it, everyone stays on.
 */
export const addCallParticipant = (
  callSid: string,
  body: { userId: string; channel: "softphone" | "personal"; handOver?: boolean },
): Promise<{ callSid: string; handOver: boolean }> =>
  http.post(`/telephony/calls/${callSid}/participants`, body);

export async function identifyNumber(
  e164: string,
): Promise<IdentifiedParty | null> {
  try {
    return await http.get<IdentifiedParty | null>(
      `/telephony/calls/identify?phone=${encodeURIComponent(e164)}`,
    );
  } catch {
    return null;
  }
}
