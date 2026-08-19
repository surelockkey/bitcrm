/**
 * What a caller hears, and who gets rung, between dialling and somebody
 * answering.
 *
 * A flow is a small state machine the inbound webhook walks: each node returns
 * TwiML and says where to go next. Nodes are held in a map rather than a list
 * because branches reference each other by id — reordering the list must not
 * rewrite the wiring.
 */
export type CallFlowNodeType = 'say' | 'ring' | 'voicemail' | 'hangup';

interface BaseNode {
  id: string;
  type: CallFlowNodeType;
  /** Where the call goes when this node finishes. Absent = the flow ends. */
  next?: string;
}

/** Speak a greeting, then carry on. */
export interface SayNode extends BaseNode {
  type: 'say';
  text: string;
}

/**
 * Ring a call group. The terminal node of most flows: whoever answers is put
 * into the conference with the caller, and `next` is where the call goes when
 * nobody does.
 */
export interface RingNode extends BaseNode {
  type: 'ring';
  groupId: string;
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

export type CallFlowNode = SayNode | RingNode | VoicemailNode | HangupNode;

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
  minVoicemailSeconds: 10,
  maxVoicemailSeconds: 300,
  defaultVoicemailSeconds: 120,
} as const;
