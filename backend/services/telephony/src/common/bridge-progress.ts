/**
 * Where a masked call ("Call client" on the phone) stands, read off the
 * status callbacks of its two legs:
 *
 *   ringing_you → you_answered → connecting_client → connected → ended
 *
 * or `failed`, with a reason a technician can act on. Pure — BridgeService
 * stores the result, ConferenceService and VoiceService feed it.
 */
export type BridgeState =
  | 'ringing_you'
  | 'you_answered'
  | 'connecting_client'
  | 'connected'
  | 'ended'
  | 'failed';

export interface BridgeProgress {
  state: BridgeState;
  /** Only on `failed`: what went wrong, in the technician's words. */
  reason?: string;
}

/** The Twilio status-callback fields an outcome is read from. */
export interface LegReport {
  CallStatus?: string;
  /** The carrier's SIP answer on a call that ended: 486 busy, 480 unavailable… */
  SipResponseCode?: string;
  /** Twilio's own error code when it refused or lost the call. */
  ErrorCode?: string;
}

export const BRIDGE_REASONS = {
  youNoAnswer: 'Your phone did not answer',
  youBusy: 'Your phone was busy',
  youUnreachable: 'Your number could not be reached',
  youBlocked: 'Your number could not be reached from the company line',
  noKeyPressed: 'No key was pressed on your phone, so the client was not called',
  clientNoAnswer: 'The client did not answer',
  clientBusy: "The client's line is busy",
  clientUnreachable: "The client's number could not be reached",
} as const;

/**
 * Twilio refusing to dial a number from this account — geo permissions
 * (13227, 21215, 32205: the dev account calling a Ukrainian handset), or a
 * number it will not or cannot dial (13223–13226, 21211, 21216, 21217). The
 * handset is fine; the company line cannot reach it.
 */
const COMPANY_LINE_ERRORS = new Set([
  '13223', '13224', '13225', '13226', '13227',
  '21211', '21215', '21216', '21217',
  '32205',
]);
const SIP_BUSY = new Set(['486', '600']);
const SIP_NO_ANSWER = new Set(['408', '480']);

const RANK: Record<BridgeState, number> = {
  ringing_you: 0,
  you_answered: 1,
  connecting_client: 2,
  connected: 3,
  ended: 4,
  failed: 4,
};

const failed = (reason: string): BridgeProgress => ({ state: 'failed', reason });

/**
 * A status callback of the technician's own leg. `current` matters for one
 * status only: `completed` ends a call that reached the client, and means
 * nobody pressed the whisper's key on one that did not.
 */
export function technicianLegProgress(
  report: LegReport,
  current: BridgeState,
): BridgeProgress | null {
  switch (report.CallStatus) {
    case 'queued':
    case 'initiated':
    case 'ringing':
      return { state: 'ringing_you' };
    case 'in-progress':
      return { state: 'you_answered' };
    case 'completed':
      return RANK[current] >= RANK.connecting_client
        ? { state: 'ended' }
        : failed(BRIDGE_REASONS.noKeyPressed);
    // Only the REST API cancels a ringing leg, and only Cancel calls it.
    case 'canceled':
      return { state: 'ended' };
    case 'busy':
      return failed(BRIDGE_REASONS.youBusy);
    case 'no-answer':
      return failed(BRIDGE_REASONS.youNoAnswer);
    case 'failed':
      if (report.ErrorCode && COMPANY_LINE_ERRORS.has(report.ErrorCode)) {
        return failed(BRIDGE_REASONS.youBlocked);
      }
      if (report.SipResponseCode && SIP_BUSY.has(report.SipResponseCode)) {
        return failed(BRIDGE_REASONS.youBusy);
      }
      if (report.SipResponseCode && SIP_NO_ANSWER.has(report.SipResponseCode)) {
        return failed(BRIDGE_REASONS.youNoAnswer);
      }
      return failed(BRIDGE_REASONS.youUnreachable);
    default:
      return null;
  }
}

/** A status callback of the leg that dials the client (the conference participant). */
export function clientLegProgress(report: LegReport): BridgeProgress | null {
  switch (report.CallStatus) {
    case 'queued':
    case 'initiated':
    case 'ringing':
      return { state: 'connecting_client' };
    case 'in-progress':
      return { state: 'connected' };
    // Canceled: our side hung up while the client was still ringing.
    case 'completed':
    case 'canceled':
      return { state: 'ended' };
    case 'busy':
      return failed(BRIDGE_REASONS.clientBusy);
    case 'no-answer':
      return failed(BRIDGE_REASONS.clientNoAnswer);
    case 'failed':
      if (report.SipResponseCode && SIP_BUSY.has(report.SipResponseCode)) {
        return failed(BRIDGE_REASONS.clientBusy);
      }
      if (report.SipResponseCode && SIP_NO_ANSWER.has(report.SipResponseCode)) {
        return failed(BRIDGE_REASONS.clientNoAnswer);
      }
      return failed(BRIDGE_REASONS.clientUnreachable);
    default:
      return null;
  }
}

/**
 * The progress to store, or null to keep what is there. Stages only move
 * forward and the first terminal outcome wins: the two legs' callbacks arrive
 * on different requests, in no promised order, and a late "ringing" must not
 * reopen a call that already failed.
 */
export function nextProgress(
  current: BridgeProgress,
  proposed: BridgeProgress,
): BridgeProgress | null {
  if (RANK[current.state] === RANK.ended) return null;
  return RANK[proposed.state] > RANK[current.state] ? proposed : null;
}
