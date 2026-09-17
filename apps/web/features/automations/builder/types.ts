import type {
  AutomationAction,
  AutomationActionType,
  AutomationConditionNode,
  AutomationSpec,
  AutomationTrigger,
} from "@bitcrm/types";
import { specToForm, toSpec, type AutomationFormOutput } from "../schemas";

/**
 * The rule as a chain of nodes (`docs/import/WORKIZ_AUTOMATION_BUILDER_UI.md`
 * §1): the same `AutomationSpec` the engine runs, read top to bottom as the
 * steps a person built. Nothing new is stored — a node is a slice of the spec,
 * and the chain is only how the editor holds it while it is open.
 */
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

/** Which node kind an action of this type is drawn as. */
const ACTION_KIND: Record<AutomationActionType, ChainNodeKind> = {
  send_sms: "send",
  send_email: "send",
  send_in_app: "send",
  webhook: "webhook",
  add_tag: "add_tag",
  change_sub_status: "change_sub_status",
};

export function actionNodeKind(type: AutomationActionType): ChainNodeKind {
  return ACTION_KIND[type] ?? "send";
}

/** Whether this node carries one of `spec.actions` — everything but the trigger, a condition and a wait. */
export function isActionNode(node: ChainNode): boolean {
  return node.kind !== "trigger" && node.kind !== "condition" && node.kind !== "wait";
}

/**
 * What a rule with no spec starts as — the same trigger and the same empty
 * text message `specToForm` has always opened a new rule on, so creating one
 * through the chain and through the old form begin from the same place.
 */
const NEW_TRIGGER: AutomationTrigger = { kind: "deal.status_changed" };
const NEW_SEND: AutomationAction = { type: "send_sms", to: "client", body: "" };

/** The default payload of each kind the "+" menu offers. */
export function newChainNode(kind: ChainNodeKind): ChainNode {
  const id = nextNodeId();
  switch (kind) {
    case "trigger":
      return { id, kind, trigger: { ...NEW_TRIGGER } };
    case "condition":
      // Nothing picked at all, not even the field. Workiz opens its "Only if…"
      // on "Select property", and picking a field for somebody reads back on
      // the card as "its job tag is any" — a sentence saying the rule checks
      // something it does not check, which is the exact widening this editor
      // exists to prevent. The panel already renders an empty row for this.
      return { id, kind };
    case "wait":
      return { id, kind, waitMinutes: 60 };
    case "send":
      return { id, kind, action: { ...NEW_SEND } };
    default:
      return { id, kind, action: { type: kind as AutomationActionType } };
  }
}

/**
 * Ids for nodes added while the editor is open. `specToChain` numbers what it
 * read (`s…`) and this numbers what was added (`n…`), so a node inserted where
 * one was deleted can never take the deleted node's React key.
 */
let added = 0;
export function nextNodeId(): string {
  added += 1;
  return `n${added}`;
}

/**
 * A stored spec (or nothing, for a new rule) → the chain. Conditions keep the
 * order they are stored in, the delay becomes a `wait` node in front of the
 * first action, and every payload is carried through untouched.
 */
export function specToChain(spec: AutomationSpec | undefined): ChainNode[] {
  const nodes: ChainNode[] = [{ id: "s-t", kind: "trigger", trigger: spec?.trigger ?? { ...NEW_TRIGGER } }];

  (spec?.conditions ?? []).forEach((condition, i) => {
    nodes.push({ id: `s-c${i}`, kind: "condition", condition });
  });

  // The engine holds one delay for the whole rule (`AutomationTiming`), and it
  // is counted from the trigger — so the wait it stands for is the one before
  // the first thing the rule does.
  const delay = spec?.timing?.delayMinutes ?? 0;
  if (delay > 0) nodes.push({ id: "s-w", kind: "wait", waitMinutes: delay });

  const actions = spec?.actions ?? [{ ...NEW_SEND }];
  actions.forEach((action, i) => {
    nodes.push({ id: `s-a${i}`, kind: actionNodeKind(action.type), action });
  });

  return nodes;
}

/**
 * The chain → what `PATCH /automations/:id` takes.
 *
 * Deliberately built on `specToForm` + `toSpec` rather than beside them: those
 * two are what the editor has always saved through, they are pinned by
 * `schemas.test.ts` for every recipe and every narrowing the editor does not
 * show, and a second converter written here would drift from them the first
 * time either side gained a field. So the chain is reassembled into a spec and
 * handed to the same pair — whatever survived a save before survives one now,
 * by construction.
 *
 * `previous` supplies what no node holds: the delivery window and what happens
 * outside it (`timing.workingHours`, `timing.quietHours`), which the footer
 * edits rather than the chain.
 */
export function chainToSpec(nodes: ChainNode[], previous?: AutomationSpec): AutomationSpec {
  const trigger = nodes.find((n) => n.kind === "trigger")?.trigger ?? previous?.trigger ?? { ...NEW_TRIGGER };

  const conditions = nodes.flatMap((n) =>
    n.kind === "condition" && n.condition ? [n.condition] : [],
  );
  const actions = nodes.flatMap((n) => (isActionNode(n) && n.action ? [n.action] : []));

  // Every action of a rule shares its one delay, so waits anywhere in the
  // chain are the same wait: 1 hour and then 30 minutes is 90 minutes before
  // anything is sent. The menu offers a second wait only as an explanation of
  // why there is not one, but a chain that somehow holds two still saves as
  // the total rather than as whichever the reader happened to write first.
  const waited = nodes.reduce(
    (total, n) => total + (n.kind === "wait" ? Math.max(0, Math.round(n.waitMinutes ?? 0)) : 0),
    0,
  );

  const assembled: AutomationSpec = {
    version: 1,
    trigger,
    conditions,
    actions,
    timing: { ...previous?.timing, delayMinutes: waited },
  };

  // `specToForm` fills every field of the form, so what it returns is already
  // a complete set of values; the two types differ only because zod counts a
  // coerced number as `unknown` going in.
  return toSpec(specToForm("", assembled) as unknown as AutomationFormOutput);
}
