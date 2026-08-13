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
