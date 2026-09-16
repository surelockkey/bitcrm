import {
  type OptOutChannel,
  type OptOutSource,
  type OptOutStatus,
} from '../enums/opt-out.enum';

export interface OptOutHistoryEntry {
  status: OptOutStatus;
  source: OptOutSource;
  keyword?: string;
  at: string;
  by?: string;
}

/** How many status flips are kept on the item. */
export const OPT_OUT_HISTORY_LIMIT = 20;

/**
 * BitCRM's own STOP/START ledger, checked before every send
 * (`OPTOUT#<channel>#<address>` / `METADATA`, design §3.2, §4.7).
 */
export interface OptOut {
  channel: OptOutChannel;
  /** E.164 or lowercase email. */
  address: string;
  status: OptOutStatus;
  /** The keyword that triggered the last change, when there was one. */
  keyword?: string;
  source: OptOutSource;
  /** Messaging Service the Twilio opt-out applies to, when known. */
  messagingServiceSid?: string;
  updatedAt: string;
  updatedBy?: string;
  /** Newest first, at most `OPT_OUT_HISTORY_LIMIT`. */
  history: OptOutHistoryEntry[];
}
