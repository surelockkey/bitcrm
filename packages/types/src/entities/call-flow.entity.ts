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
  | 'hangup';

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

export type CallFlowNode =
  | SayNode
  | HoursNode
  | MenuNode
  | RingNode
  | VoicemailNode
  | HangupNode;

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
  minVoicemailSeconds: 10,
  maxVoicemailSeconds: 300,
  defaultVoicemailSeconds: 120,
} as const;
