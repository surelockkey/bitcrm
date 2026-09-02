/**
 * What a caller hears, and who gets rung, between dialling and somebody
 * answering.
 *
 * A flow is a small state machine the inbound webhook walks: each node returns
 * TwiML and says where to go next. Nodes are held in a map rather than a list
 * because branches reference each other by id — reordering the list must not
 * rewrite the wiring.
 */
export type CallFlowNodeType =
  | 'say'
  | 'hours'
  | 'menu'
  | 'ring'
  | 'voicemail'
  | 'hangup'
  | 'ext';

interface BaseNode {
  id: string;
  type: CallFlowNodeType;
  /** Where the call goes when this node finishes. Absent = the flow ends. */
  next?: string;
}

/**
 * Speak a greeting, then carry on.
 *
 * `audioId` wins over `text` when set: a recorded voice is what most
 * businesses actually want on their main line, and the text stays as the thing
 * a human can read in the editor.
 */
export interface SayNode extends BaseNode {
  type: 'say';
  text: string;
  audioId?: string;
}

/** One opening period. `0` is Sunday, matching JS. */
export interface BusinessHoursWindow {
  day: number;
  /** 24h `HH:MM`, read in the node's timezone. */
  open: string;
  close: string;
}

/**
 * Split the call on the clock.
 *
 * The one node that needs a timezone of its own: a workspace in Phoenix and a
 * server in UTC disagree about what "open" means, and DST makes the server's
 * clock the wrong answer twice a year.
 */
export interface HoursNode extends BaseNode {
  type: 'hours';
  timezone: string;
  windows: BusinessHoursWindow[];
  /** `YYYY-MM-DD` dates that are closed whatever the windows say. */
  holidays?: string[];
  /** Where an open call goes; `next` is the closed branch. */
  openNext?: string;
}

/** A key on the menu, and where pressing it leads. */
export interface MenuOption {
  /** A single character: 0–9, `*` or `#`. */
  key: string;
  label: string;
  next: string;
}

/**
 * "Press 1 for…". `next` is where somebody who presses nothing ends up, so a
 * silent line or an old handset still reaches a person rather than a dead end.
 */
export interface MenuNode extends BaseNode {
  type: 'menu';
  prompt: string;
  audioId?: string;
  options: MenuOption[];
  timeoutSeconds: number;
  /** How many times to re-read the prompt before giving up on input. */
  repeats: number;
}

/**
 * Ring a call group. The terminal node of most flows: whoever answers is put
 * into the conference with the caller, and `next` is where the call goes when
 * nobody does.
 */
export interface RingNode extends BaseNode {
  type: 'ring';
  groupId: string;
  /**
   * Where the call goes once the conversation is over — a closing message, a
   * survey, anything. `next` is the other outcome: nobody picked up.
   *
   * Without this the call simply ends when the conference does, because a
   * `<Dial>` with nothing after it is the end of the TwiML.
   */
  answeredNext?: string;
  /**
   * Make a personal phone press a key before it joins.
   *
   * A mobile's voicemail answers, and would otherwise win the race — taking
   * the call from everyone still ringing and leaving the customer talking to a
   * recording. A browser can't do that, so this only ever applies to personal
   * numbers.
   */
  whisper?: boolean;
}

/** Take a message. */
export interface VoicemailNode extends BaseNode {
  type: 'voicemail';
  /** Spoken before the beep. */
  prompt: string;
  /** Hard stop, so a silent line can't record forever. */
  maxSeconds: number;
}

/** End the call, optionally after saying something. */
export interface HangupNode extends BaseNode {
  type: 'hangup';
  text?: string;
}

/**
 * Collect a job code, then connect the caller to that job's client.
 *
 * The technician dial-in: one shared line a technician can call from ANY
 * handset — a dead-battery loaner, a borrowed phone, a company mobile that
 * never got the app — and still reach the client through the CRM rather than
 * around it.
 *
 * The code is the whole credential. A guessed one opens a CALL to that job's
 * client and reveals no phone number to anybody, so the exposure is a nuisance
 * call rather than a leak; the defences are rate limiting on the resolver and
 * the fact that a code dies with its job.
 *
 * Unlike `menu`, this node cannot be modelled with single-key options: it
 * collects a multi-digit code, counts its own retries in call state (the graph
 * validator refuses cycles, so a retry cannot be an edge), and resolves in
 * `resume()` rather than `execute()`, which never sees digits.
 */
export interface ExtNode extends BaseNode {
  type: 'ext';
  /** Spoken before the code is collected. */
  prompt: string;
  audioId?: string;
  /**
   * Spoken with the client's name before anything is dialled, so a mistyped
   * code is caught by the person who typed it rather than by the client.
   */
  confirmPrompt: string;
  /** How many attempts before the caller is handed to `next`. */
  repeats: number;
  timeoutSeconds: number;
  /** Where a connected caller's flow ends; absent = the conference is the end. */
  answeredNext?: string;
  /** Where an unrecognised or exhausted caller goes — typically dispatch. */
  next?: string;
}

export type CallFlowNode =
  | SayNode
  | HoursNode
  | MenuNode
  | RingNode
  | VoicemailNode
  | HangupNode
  | ExtNode;

/** An uploaded greeting, stored once and reusable across flows. */
export interface CallFlowAudio {
  id: string;
  name: string;
  contentType: string;
  sizeBytes: number;
  uploadedBy: string;
  uploadedAt: string;
}

export interface CallFlow {
  id: string;
  name: string;
  description?: string;
  /**
   * The numbers this flow answers, E.164. Held here rather than on a number
   * record: numbers live in Twilio and we keep no local copy of them, so
   * inverting the reference avoids a table that would exist for one field.
   */
  numbers: string[];
  entryNodeId: string;
  nodes: Record<string, CallFlowNode>;
  /** A flow can be drafted without answering calls. */
  active: boolean;
  /**
   * Bumped on every save. A call already in flight keeps the version it
   * started on, so editing a flow can't teleport a live caller.
   */
  version: number;
  createdBy: string;
  createdAt: string;
  updatedBy?: string;
  updatedAt: string;
}

export const CALL_FLOW_LIMITS = {
  nameMaxLength: 60,
  /** Guards against a flow that loops a caller forever (and bills for it). */
  maxHops: 20,
  maxNodes: 40,
  maxMenuOptions: 9,
  /** Long enough for a real greeting, short enough that a mistake is cheap. */
  maxAudioBytes: 5 * 1024 * 1024,
  /** Digits in a job code — four keypresses at a customer's door.
   *
   *  Server-side and NOT a per-node field: an admin setting one length while
   *  the allocator mints another is a footgun with no upside.
   *
   *  Four, not three: 9,000 usable codes against roughly 2,600 in circulation
   *  (~200 jobs a week held for a 90-day quarantine) leaves real headroom,
   *  where three digits offers 900 and exhausts outright. Three is reachable
   *  only by shortening TELEPHONY_EXT_QUARANTINE_DAYS, which trades a
   *  keypress for the risk of a code being reused while an old work order is
   *  still in somebody's van. Four is not the credential anyway — the PIN is,
   *  and it is checked against that job's roster. */
  extDigits: 4,
  /** Attempts per call before the caller is handed to dispatch. Well under
   *  maxHops, since each attempt burns one. */
  extMaxAttempts: 3,
  minVoicemailSeconds: 10,
  maxVoicemailSeconds: 300,
  defaultVoicemailSeconds: 120,
} as const;
