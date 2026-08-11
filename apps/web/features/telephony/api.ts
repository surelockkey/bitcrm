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
 * Screen-pop lookup: resolve a caller/callee number to a contact. Returns null
 * on any error (missing permission, no match) — screen-pop is best-effort.
 */
export async function lookupContactByPhone(
  e164: string,
): Promise<ContactMatch | null> {
  try {
    return await http.get<ContactMatch | null>(
      `/crm/contacts/search/by-phone?phone=${encodeURIComponent(e164)}`,
    );
  } catch {
    return null;
  }
}

export function contactDisplayName(c: ContactMatch | null): string | undefined {
  if (!c) return undefined;
  const full = [c.firstName, c.lastName].filter(Boolean).join(" ").trim();
  return full || c.companyName || undefined;
}
