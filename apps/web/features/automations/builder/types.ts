/**
 * ────────────────────────────────────────────────────────────────────────────
 * PLACEHOLDER — the chain stream owns this file. On merge, take THEIRS.
 *
 * Only the two declarations the panels import are written here, word for word
 * as the agreed contract spells them, so this half compiles before the chain
 * canvas lands. `specToChain` / `chainToSpec` are deliberately absent: the
 * mapping is the chain stream's, and a second implementation of it is exactly
 * the drift the contract exists to prevent.
 * ────────────────────────────────────────────────────────────────────────────
 */
import type { AutomationAction, AutomationConditionNode, AutomationTrigger } from "@bitcrm/types";

export type ChainNodeKind =
  | "trigger"
  | "condition"
  | "send"
  | "add_tag"
  | "change_sub_status"
  | "webhook"
  | "wait";

export interface ChainNode {
  /** Stable within one editing session; never stored. */
  id: string;
  kind: ChainNodeKind;
  /** The trigger node's payload — one AutomationSpec['trigger']. */
  trigger?: AutomationTrigger;
  /** A condition node's payload — exactly one node of spec.conditions (a condition or an { any: [...] } group). */
  condition?: AutomationConditionNode;
  /** An action node's payload — exactly one entry of spec.actions. */
  action?: AutomationAction;
  /** A 'wait' node — minutes before the action that follows it. */
  waitMinutes?: number;
}
