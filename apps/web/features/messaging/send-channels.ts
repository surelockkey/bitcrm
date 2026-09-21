import type {
  ConversationSendOptions,
  SendChannelOption,
  SendUnavailableReason,
  SendableMessageChannel,
} from "@bitcrm/types";
import { formatPhone } from "@/lib/phone";
import type { InboxConversation } from "./api";

/* --------------------------------------------------------------- labels */

/** The yellow button, per channel — Workiz's "Send Text" with the other two beside it. */
export const SEND_BUTTON_LABEL: Record<SendableMessageChannel, string> = {
  in_app: "Send In App",
  sms: "Send Text",
  email: "Send Email",
};

/** The channel as the chevron menu names it. */
export const SEND_CHANNEL_LABEL: Record<SendableMessageChannel, string> = {
  in_app: "In App",
  sms: "Text",
  email: "Email",
};

/**
 * Why a channel is closed, in words a dispatcher can act on: what is missing
 * and who can add it, never the 4xx the send would have answered with.
 */
const REASON_TEXT: Record<SendUnavailableReason, string> = {
  no_phone: "No phone number on this conversation — add one to the contact first.",
  phone_hidden: "Their number is hidden from you, so this has to go out from someone who can see it.",
  opted_out_sms: "They replied STOP — texts stay blocked until they text START.",
  employee_has_no_phone: "No personal phone on their profile — add one, or send it in app.",
  employee_unknown: "Their personal number could not be looked up just now.",
  no_email: "No email address on this conversation — add one to the contact first.",
  opted_out_email: "This address unsubscribed from email.",
  email_not_configured: "Email sending is not set up for this workspace yet.",
  not_a_team_thread: "In-app messages reach teammates inside BitCRM; a client has no app to read them.",
};

export const unavailableText = (reason: SendUnavailableReason | undefined): string | undefined =>
  reason ? REASON_TEXT[reason] : undefined;

/* ---------------------------------------------------------- destinations */

/** Where a message would arrive and what it would leave from, both ready to render. */
export interface SendDestination {
  to: string;
  from?: string;
}

/**
 * "to (404) 555-1234 · from (202) 555-0100". `pickedFrom` is the number the
 * agent chose behind the chevron, which beats the chain's own answer — it is
 * the one that would be sent. Nothing is invented: a channel that resolved no
 * recipient has nothing to show.
 */
export function describeDestination(
  option: SendChannelOption | undefined,
  pickedFrom?: string,
): SendDestination | undefined {
  if (!option) return undefined;
  if (option.channel === "in_app") {
    return option.toName ? { to: option.toName } : { to: "everyone in this thread" };
  }
  const to =
    option.channel === "sms"
      ? option.to
        ? formatPhone(option.to)
        : option.toMasked
          ? "a number you can't see"
          : undefined
      : option.to;
  if (!to) return undefined;
  const from = option.channel === "sms" ? pickedFrom ?? option.from : option.from;
  return { to, from: from ? (option.channel === "sms" ? formatPhone(from) : from) : undefined };
}

/* ------------------------------------------------------------ the options */

export const optionFor = (
  options: ConversationSendOptions | undefined,
  channel: SendableMessageChannel,
): SendChannelOption | undefined => options?.channels.find((c) => c.channel === channel);

const TEAM_KINDS = new Set(["team", "group"]);

/**
 * What the thread itself can prove, for the moment before
 * `GET /conversations/:id/send-options` answers — and for the thread whose
 * answer never comes (a caller who may read it but not write in it gets a
 * 403 there). The server's answer replaces this the instant it lands.
 *
 * It only claims what the conversation entity actually settles: in-app is the
 * team / group rule (`isTeamKind`, the same constant the send checks), and a
 * channel is closed only where the thread carries no address at all. Where it
 * cannot know — a teammate's personal phone lives in the directory, an
 * unsubscribed address in the opt-out ledger — it stays out of the way and
 * leaves the send to be the authority, exactly as before this existed.
 */
export function fallbackSendOptions(
  conversation: InboxConversation | undefined,
): ConversationSendOptions | undefined {
  if (!conversation) return undefined;
  const team = TEAM_KINDS.has(conversation.kind);
  const phone = conversation.addresses?.phones?.[0];
  const email = conversation.addresses?.emails?.[0];

  const inApp: SendChannelOption = team
    ? { channel: "in_app", available: true, toName: conversation.kind === "group" ? conversation.name : undefined }
    : { channel: "in_app", available: false, reason: "not_a_team_thread" };

  let sms: SendChannelOption;
  if (phone) sms = { channel: "sms", available: true, to: phone };
  else if (conversation.phonesMasked) sms = { channel: "sms", available: true, toMasked: true };
  // An employee is texted on the number their profile carries, which only the
  // server can read — so this says nothing rather than the wrong thing.
  else if (conversation.partyKind === "user") sms = { channel: "sms", available: true };
  else sms = { channel: "sms", available: false, reason: "no_phone" };

  const emailOption: SendChannelOption = email
    ? { channel: "email", available: true, to: email }
    : { channel: "email", available: false, reason: "no_email" };

  const channels = team ? [inApp, sms, emailOption] : [sms, emailOption, inApp];
  return {
    conversationId: conversation.id,
    defaultChannel: channels.find((c) => c.available)?.channel,
    channels,
  };
}

/**
 * The one line above the box when the thread can send nothing at all: every
 * closed channel that was ever plausible here, in one breath. In-app on a
 * client thread is not a fault to report — it is simply not that kind of
 * thread — so it is left to the menu to explain.
 */
export function deadEndText(options: ConversationSendOptions | undefined): string | undefined {
  if (!options || options.channels.some((c) => c.available)) return undefined;
  const reasons = options.channels
    .filter((c) => c.reason && c.reason !== "not_a_team_thread")
    .map((c) => unavailableText(c.reason))
    .filter((text): text is string => !!text);
  if (!reasons.length) return "Nothing can be sent from this thread.";
  return `Nothing can be sent from this thread. ${reasons.join(" ")}`;
}
