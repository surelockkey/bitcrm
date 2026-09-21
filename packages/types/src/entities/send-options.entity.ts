import { type SenderSource } from '../enums/message-origin.enum';
import { type SendableMessageChannel } from '../enums/message-channel.enum';

/**
 * Why a channel cannot carry a message from this thread. One code per real
 * cause, so the composer can word it for a dispatcher instead of repeating
 * the 4xx the send would have answered with.
 *
 * - `no_phone`              the thread has no number to text
 * - `phone_hidden`          — reserved: a masked viewer still sends, they
 *                             just never see the digits (`toMasked`)
 * - `opted_out_sms`         the recipient replied STOP
 * - `employee_has_no_phone` a teammate with no personal phone on file
 * - `employee_unknown`      the staff directory has no such user, or could
 *                           not be reached to ask
 * - `no_email`              the thread has no address to write to
 * - `opted_out_email`       the address unsubscribed (bounce, complaint, manual)
 * - `email_not_configured`  the workspace has no sending address (`MESSAGING_EMAIL_FROM`)
 * - `not_a_team_thread`     in-app is a line in a teammate's or a group's
 *                           thread; a client has no app to receive it
 */
export const SEND_UNAVAILABLE_REASONS = [
  'no_phone',
  'phone_hidden',
  'opted_out_sms',
  'employee_has_no_phone',
  'employee_unknown',
  'no_email',
  'opted_out_email',
  'email_not_configured',
  'not_a_team_thread',
] as const;
export type SendUnavailableReason = (typeof SEND_UNAVAILABLE_REASONS)[number];

/** What one channel of the composer's send control would do with this thread. */
export interface SendChannelOption {
  channel: SendableMessageChannel;
  /** The send would be accepted — as far as anything can be known before it is made. */
  available: boolean;
  /** Set only when `available` is false. */
  reason?: SendUnavailableReason;
  /** Where it would arrive: an E.164 number, a lowercase email address. */
  to?: string;
  /** The recipient is a phone number and this viewer may not see digits (`contacts.view_numbers`). */
  toMasked?: true;
  /** Who it would reach when that is a person, not an address — a teammate, a group. */
  toName?: string;
  /** What the recipient would see it come from: our number, our sending address. */
  from?: string;
  /** Which rung of the sender chain `from` came off (SMS only); `pool` = Twilio picks. */
  fromSource?: SenderSource;
}

/**
 * `GET /conversations/:id/send-options` — the send rules answered before the
 * message is typed rather than after it is refused (design §4.4, §5, §6).
 * Everything here is resolved exactly as the send path resolves it: the same
 * recipient, the same sender chain, the same opt-out ledgers.
 */
export interface ConversationSendOptions {
  conversationId: string;
  /** The channel the composer should open on: the first available one, if any. */
  defaultChannel?: SendableMessageChannel;
  /** Every sendable channel, in the order this thread should offer them. */
  channels: SendChannelOption[];
}
