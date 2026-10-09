/*
 * Workiz's "On-screen notifications" (the avatar menu's first row,
 * uikit_wz_avatar_menu; settings_audit.md §1): while the web app is open the
 * browser pops a desktop notification for what reaches this person — an
 * inbound message, an @mention, an incoming call. A per-browser switch, as
 * browser notifications are per browser by nature.
 *
 * This file is the decision: given a frame off the messaging stream (or a
 * ringing call) and what the tab knows about itself, what to show — or
 * nothing. Pure, so every suppression (the switch off, no permission, my own
 * message, the thread already open and in front of me) is a line of a test.
 */

export type OnScreenPermission = "granted" | "denied" | "default" | "unsupported";

export interface OnScreenContext {
  /** The avatar-menu switch. */
  enabled: boolean;
  permission: OnScreenPermission;
  meId?: string;
  /** This tab is the one in front of the reader (focused and visible). */
  focused: boolean;
  /** The thread open in this tab (`/messages?c=`), if any. */
  openConversationId?: string;
}

/** The parts of a stream frame the decision reads — a subset of `FeedMessage` / `InboxConversation`. */
export interface OnScreenMessage {
  id: string;
  conversationId: string;
  direction: "inbound" | "outbound";
  body?: string;
  sentByUserId?: string;
  sentByName?: string;
  from?: string;
  attachments?: ReadonlyArray<{ id: string }>;
}

export interface OnScreenConversation {
  id: string;
  kind: "client" | "unknown" | "team" | "group" | "external";
  partyKind: "contact" | "company" | "user" | "group" | "none";
  partyId?: string;
  name?: string;
}

export type OnScreenInput =
  | {
      kind: "message";
      message: OnScreenMessage;
      conversation?: OnScreenConversation;
      /** The party's name when the tab knows it (a contact, a company, a group). */
      partyName?: string;
      /** Team / group delivery: the member ids the line is for (the stream's `recipients`). */
      recipients?: string[];
      /** User ids @-mentioned (the stream's `mentions`). */
      mentions?: string[];
    }
  | { kind: "call"; number: string; contactName?: string };

export interface OnScreenNotice {
  title: string;
  body: string;
  /** The browser folds notifications with one tag — one per message, however many tabs are open. */
  tag: string;
  /** What a click brings to the front. */
  open: { kind: "thread"; conversationId: string } | { kind: "call" };
}

/** A notification shows one line; the conversation list cuts previews at 160 too. */
const BODY_MAX = 160;

const oneLine = (body: string | undefined): string | undefined => {
  const text = (body ?? "").replace(/\s+/g, " ").trim();
  if (!text) return undefined;
  return text.length > BODY_MAX ? `${text.slice(0, BODY_MAX)}…` : text;
};

/**
 * Whether this line is news for the reader: something that came in from a
 * client, or a teammate's in-app line addressed to them. Never their own
 * words, and never what the office sent out to a client.
 */
function isForMe(input: Extract<OnScreenInput, { kind: "message" }>, meId: string | undefined): boolean {
  const { message, recipients } = input;
  if (meId && message.sentByUserId === meId) return false;
  if (recipients) return !!meId && recipients.includes(meId);
  if (message.direction === "inbound") return true;
  // An outbound line with an author is a teammate writing in a team / group
  // thread; one without is the system or the office texting a client.
  return !!message.sentByUserId;
}

function senderName(input: Extract<OnScreenInput, { kind: "message" }>): string | undefined {
  const { message, conversation, partyName } = input;
  if (message.sentByUserId || conversation?.kind === "team" || conversation?.kind === "group") {
    return message.sentByName || partyName || conversation?.name || message.from;
  }
  return partyName || conversation?.name || message.from;
}

/** What to pop for this input, or `null` to stay quiet. */
export function decideOnScreenNotification(input: OnScreenInput, ctx: OnScreenContext): OnScreenNotice | null {
  if (!ctx.enabled || ctx.permission !== "granted") return null;

  if (input.kind === "call") {
    return {
      title: "Incoming call",
      body: input.contactName ? `${input.contactName} · ${input.number}` : input.number,
      tag: `call:${input.number}`,
      open: { kind: "call" },
    };
  }

  const { message, mentions } = input;
  if (!isForMe(input, ctx.meId)) return null;
  // The reader is looking at it already.
  if (ctx.focused && ctx.openConversationId && ctx.openConversationId === message.conversationId) return null;

  const who = senderName(input);
  const mentioned = !!ctx.meId && !!mentions?.includes(ctx.meId);
  const title = mentioned ? `${who ?? "Someone"} mentioned you` : who ? `New message from ${who}` : "New message";
  const body = oneLine(message.body) ?? (message.attachments?.length ? "Attachment" : "New message");
  return {
    title,
    body,
    tag: `message:${message.id}`,
    open: { kind: "thread", conversationId: message.conversationId },
  };
}

/* ----------------------------------------------------------- the setting */

export const ON_SCREEN_STORAGE_KEY = "bitcrm.on-screen-notifications";

/** The two calls the setting makes — `localStorage`'s, or a stand-in. */
export interface SettingStorage {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
}

const browserStorage = (): SettingStorage | undefined => (typeof window === "undefined" ? undefined : window.localStorage);

/** Off until switched on in this browser; off too where storage cannot be read. */
export function readOnScreenSetting(storage: SettingStorage | undefined = browserStorage()): boolean {
  try {
    return storage?.getItem(ON_SCREEN_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

/** Remembered for this browser; a storage that refuses (a private window) loses nothing but the memory. */
export function writeOnScreenSetting(enabled: boolean, storage: SettingStorage | undefined = browserStorage()): void {
  try {
    storage?.setItem(ON_SCREEN_STORAGE_KEY, enabled ? "1" : "0");
  } catch {
    // Nothing to do: the switch still works for this session.
  }
}

/** What the browser says about notifications, in one word the decision understands. */
export function browserNotificationPermission(): OnScreenPermission {
  if (typeof window === "undefined" || typeof Notification === "undefined") return "unsupported";
  return Notification.permission;
}
