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
  /** Unique where a name isn't — two people can share one. */
  email?: string;
  roleId?: string;
  /** Their own number, when set — the route that works when they're away. */
  phone?: string;
  softphoneOnline: boolean;
}

/**
 * Who a call can be handed to. `includeSelf` keeps the caller in the list —
 * wrong for a transfer, right for building a call group.
 */
export const listTransferTargets = (
  includeSelf = false,
): Promise<TransferTarget[]> =>
  http.get<TransferTarget[]>(
    `/telephony/presence/online${includeSelf ? "?includeSelf=1" : ""}`,
  );

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

/** What the server hands back after preparing a masked call. */
export interface StartedBridge {
  bridgeId: string;
  /** `softphone` when the technician is at a browser; `cell` rings their handset. */
  mode: "softphone" | "cell";
  /** Present only on the cell path — the leg that is ringing their phone. */
  callSid?: string;
  /** The client's NAME. Their number is never sent to the browser. */
  clientName?: string;
}

/**
 * Place a masked call to a job's client.
 *
 * The body is a handle, never a number: the server resolves the client's phone
 * itself and Twilio dials it, so the browser — and therefore the technician —
 * never holds it.
 */
export const startBridge = (body: {
  dealId: string;
  contactId: string;
  phoneIndex?: number;
  /**
   * Which end rings the caller. `cell` rings their own handset and dials the
   * client once they pick up; `softphone` opens a browser leg. Omitted, the
   * server decides from presence.
   */
  via?: "cell" | "softphone";
}): Promise<StartedBridge> => http.post("/telephony/calls/bridge", body);

/** Abandon a bridge while the technician's handset is still ringing. */
export const cancelBridge = (
  bridgeId: string,
): Promise<{ cancelled: boolean }> =>
  http.delete(`/telephony/calls/bridge/${bridgeId}`);

/**
 * The technician-line code for a job.
 *
 * Shown to anyone who may call about the job, INCLUDING a masked user — the
 * code is precisely what they get instead of the number. A screenshot of it is
 * harmless: it says which job, and the PIN that makes it work is never on the
 * screen.
 */
export const fetchJobCode = (dealId: string): Promise<{ code: string }> =>
  http.get(`/telephony/exts/by-deal/${dealId}`);

/** Retire a job's code and mint a new one. */
export const rotateJobCode = (dealId: string): Promise<{ code: string }> =>
  http.post(`/telephony/exts/by-deal/${dealId}/rotate`);

/** Workspace telephony settings the browser needs — currently the shared line. */
export const fetchTelephonyConfig = (): Promise<{
  technicianLine: string | null;
}> => http.get("/telephony/config");
