/**
 * The Workiz user card has fields we have no data for. They are drawn anyway —
 * dead, in their place, so the page keeps the shape the owner's people already
 * know, and so wiring one later is a data change rather than a redesign.
 *
 * Three rules this file exists to hold in one testable place, the same ones the
 * mobile Finance tab works to:
 *
 *  1. **No value is ever invented.** Every control below renders empty and
 *     disabled. A plausible-looking default here would be read as this
 *     person's setting, and acted on.
 *  2. **Every dead control says so, once, in its own words.** One short line
 *     under the control — not a tooltip, not a badge that means nothing to the
 *     person reading it.
 *  3. **Nothing dead ever saves.** No handler, no Save button of its own.
 *
 * Labels are Workiz's, read off `app.workiz.com/root/editUser/460479`
 * 2026-09-17 and recorded in `WORKIZ_USER_PAGE_PARITY.md`; the notes are ours
 * and say what we hold instead.
 */

/** How the dead control is drawn. `static` is a box of text, not a control. */
export type NotConnectedKind = "text" | "select" | "switch" | "textarea" | "static";

export interface NotConnectedField {
  /** Stable key — also the test id, so a test can name one field. */
  key: string;
  /** Workiz's own label for the field. */
  label: string;
  /** One short line: what we hold instead, or why it isn't here yet. */
  note: string;
  kind: NotConnectedKind;
}

/** Said once above the block of dead settings below the form. */
export const NOT_CONNECTED_BANNER =
  "Workiz settings we have no data for. They are drawn where Workiz puts them so the page reads the same; nothing in this section is live and nothing here saves.";

/**
 * Right column — the work. The person column has nothing dead left in it:
 * user type, additional numbers, the photo and the field-team switch all went
 * live on 2026-09-17.
 */
export const WORK_NOT_CONNECTED = {
  twoFactor: {
    key: "two-factor",
    label: "Two-factor authentication",
    note: "Sign-in runs through Cognito; there is no per-user switch for it yet.",
    kind: "switch",
  },
  notes: {
    key: "notes",
    label: "Notes",
    note: "A free note about a person isn't stored anywhere yet.",
    kind: "textarea",
  },
} as const satisfies Record<string, NotConnectedField>;

/**
 * Workiz's availability block opens with this toggle and puts the work hours
 * under it. Ours keeps it there, above our hours editor, rather than in the
 * block of dead settings — the hours beneath it are live, and the toggle is
 * the sentence that explains why they must be set by hand.
 */
export const AVAILABILITY_NOT_CONNECTED: NotConnectedField = {
  key: "availability-same-as-business",
  label: "User availability same as business hours",
  note: "Company-wide business hours aren't held yet, so there is nothing to inherit — set the hours below.",
  kind: "switch",
};

/**
 * Below the two columns, Workiz gives each of these a block and a Save of its
 * own. Ours are one block together: six dead Save buttons would be six
 * promises, and a dead field reads as dead more easily sitting with the others
 * than dressed as a section that works.
 *
 * Their order within the block is Workiz's: sync email, allowed IPs, the three
 * notification switches, signature.
 */
export const SETTINGS_NOT_CONNECTED: NotConnectedField[] = [
  {
    key: "sync-email",
    label: "Sync email",
    note: "Calendar sync is an integration of its own and isn't built.",
    kind: "text",
  },
  {
    key: "allowed-ips",
    label: "Allowed IP addresses",
    note: "Sign-in isn't restricted by address. Leave empty if all IPs apply.",
    kind: "text",
  },
  {
    key: "notify-sms-all-numbers",
    label: "Send an SMS to all of the user's numbers when a job is dispatched",
    note: "Belongs to the notification centre, which isn't built yet.",
    kind: "switch",
  },
  {
    key: "notify-incoming-messages",
    label: "Notify about every incoming message on the account",
    note: "Belongs to the notification centre, which isn't built yet.",
    kind: "switch",
  },
  {
    key: "notify-outgoing-messages",
    label: "Notify about every outgoing message on the account",
    note: "Belongs to the notification centre, which isn't built yet.",
    kind: "switch",
  },
  {
    key: "user-signature",
    label: "User signature",
    note: "Outgoing email is sent from one office address and carries no per-user signature.",
    kind: "textarea",
  },
];

/** Every dead field on the card, for tests that must hold across all of them. */
export function allNotConnected(): NotConnectedField[] {
  return [
    ...Object.values(WORK_NOT_CONNECTED),
    AVAILABILITY_NOT_CONNECTED,
    ...SETTINGS_NOT_CONNECTED,
  ];
}
