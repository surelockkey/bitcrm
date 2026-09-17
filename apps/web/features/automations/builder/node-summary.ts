import {
  automationActionSentence,
  automationConditionsSentence,
  automationDelayText,
  automationTriggerSentence,
  isAutomationConditionGroup,
  type AutomationConditionNode,
  type AutomationLabelMap,
  type AutomationSpec,
} from "@bitcrm/types";
import { SUPER_STATUS_LABEL, triggerHasJob } from "../lib";
import { actionSchema } from "../schemas";
import type { ChainNode, ChainNodeKind } from "./types";

/** The small line above a card: what kind of step this is (§3). */
export const KIND_LABEL: Record<ChainNodeKind, string> = {
  trigger: "Trigger",
  condition: "Only if",
  send: "Send",
  add_tag: "Apply a tag",
  change_sub_status: "Change the sub-status",
  webhook: "Post a webhook",
  wait: "Wait",
};

/** What a card says while its step is still empty (§3). */
const PLACEHOLDER: Record<ChainNodeKind, string> = {
  trigger: "Choose a trigger",
  condition: "Choose what to check",
  send: "Choose what to send",
  add_tag: "Choose a tag",
  change_sub_status: "Choose a status",
  webhook: "Choose where to post",
  wait: "Choose how long to wait",
};

const capitalise = (text: string): string => (text ? text[0].toUpperCase() + text.slice(1) : text);

/** A condition that actually narrows something — `toSpec`'s own rule. */
const narrows = (op: string, values: string[] | undefined): boolean =>
  op === "exists" || op === "not_exists" || (values?.length ?? 0) > 0;

/** Nothing picked anywhere in it, so `toSpec` would not store it at all. */
const conditionIsEmpty = (condition: AutomationConditionNode): boolean =>
  isAutomationConditionGroup(condition)
    ? !condition.any.some((c) => narrows(c.op, c.values))
    : !narrows(condition.op, condition.values);

/** A spec built around one node, so the sentence builders can read it. */
const specAround = (over: Partial<AutomationSpec>): AutomationSpec => ({
  version: 1,
  trigger: { kind: "deal.created" },
  conditions: [],
  actions: [],
  ...over,
});

/**
 * One node as a line of the Workiz sentence. Built by the same functions the
 * rule's whole sentence is built from (`automation-spec.ts`), never beside
 * them: the card under a rule's name, the live sentence and this card have to
 * say the same thing in the same words, and three builders would say three.
 *
 * The names a spec carries about itself reach these through the caller's
 * `labels` — a chain node is a slice of a spec and has no `automationSpecLabels`
 * of its own to fall back on.
 */
export function chainNodeSummary(node: ChainNode, labels?: AutomationLabelMap): string {
  const named: AutomationLabelMap = { ...SUPER_STATUS_LABEL, ...labels };
  switch (node.kind) {
    case "trigger":
      return node.trigger ? automationTriggerSentence(specAround({ trigger: node.trigger }), named) : PLACEHOLDER.trigger;
    case "condition": {
      // A row with nothing picked yet reads as "its job tag is any", which is
      // a sentence about a rule nobody wrote. An unfinished step says so (§3).
      if (!node.condition || conditionIsEmpty(node.condition)) return PLACEHOLDER.condition;
      // The conditions half of the sentence, with its leading "and" — this is
      // one clause of it, so the word that joins it to the clause before is
      // not part of what the card says.
      const clause = automationConditionsSentence(specAround({ conditions: [node.condition] }), named).replace(
        /^\s*and\s+/,
        "",
      );
      if (clause) return capitalise(clause);
      // `isLead` is the one condition the sentence deliberately never says —
      // BitCRM has no separate lead entity, so it holds for every job. The
      // card still has to show the step is filled in, or a reader deletes a
      // line that reads as one nobody finished.
      return isAutomationConditionGroup(node.condition) ? PLACEHOLDER.condition : "This check holds for every job";
    }
    case "wait": {
      const minutes = node.waitMinutes ?? 0;
      if (minutes <= 0) return PLACEHOLDER.wait;
      return `Wait ${automationDelayText(minutes).replace(/^after /, "")} before the steps below`;
    }
    default:
      return node.action ? capitalise(automationActionSentence(node.action, named)) : PLACEHOLDER[node.kind];
  }
}

export interface NodeIssue {
  /** `blocks` keeps the rule from being saved; `warns` is the rule saying less than the reader thinks. */
  level: "blocks" | "warns";
  text: string;
}

/** Recipients read off the job — nobody a call or an inbound message can name. */
const JOB_RECIPIENTS = new Set(["assigned_techs", "dispatcher"]);

const RECIPIENT_LABEL: Record<string, string> = {
  client: "The client",
  assigned_techs: "The assigned technicians",
  dispatcher: "The dispatcher",
  users: "Selected users",
  role: "A role",
  number: "A number",
};

/**
 * What is wrong with one step, in the reader's words and on the card that owns
 * it (§3, §7) — so "Save" being grey is explained where it can be fixed rather
 * than at the bottom of a form.
 *
 * Action steps are weighed by `actionSchema`, the same schema the save path
 * runs, so a card can never claim a step is finished that the save then
 * refuses. The rest are the narrowings only this editor can see: a step that
 * narrows nothing, a recipient the trigger cannot reach.
 */
export function nodeIssue(node: ChainNode, chain: ChainNode[]): NodeIssue | undefined {
  const kind = chain.find((n) => n.kind === "trigger")?.trigger?.kind;

  if (node.kind === "trigger") {
    const trigger = node.trigger;
    if (!trigger) return { level: "blocks", text: "Choose what starts this rule." };
    if (
      trigger.kind === "deal.status_changed" &&
      !trigger.to?.length &&
      !trigger.toSubStatus?.length
    ) {
      // The same widening the conditions list warns about, in the same words:
      // a status trigger naming no status fires on every status change.
      return { level: "warns", text: "No status picked, so this fires on every status change." };
    }
    return undefined;
  }

  if (node.kind === "condition") {
    const condition = node.condition;
    if (!condition) return { level: "warns", text: "Nothing to check yet, so this line is not saved with the rule." };
    return conditionIsEmpty(condition)
      ? { level: "warns", text: "Nothing picked, so this line narrows nothing and is not saved with the rule." }
      : undefined;
  }

  if (node.kind === "wait") {
    return (node.waitMinutes ?? 0) > 0
      ? undefined
      : { level: "warns", text: "No wait set, so the steps below run straight away." };
  }

  const action = node.action;
  if (!action) return { level: "blocks", text: "Choose what this step does." };

  // A tag or a status with nothing chosen is a step the engine runs and that
  // does nothing at all — `actionSchema` has never been asked about these two
  // (the old editor offered neither), so they are asked about here.
  if (action.type === "add_tag" && !action.tagId) {
    return { level: "blocks", text: "Pick the tag to put on the job" };
  }
  if (action.type === "change_sub_status" && !action.subStatusId && !action.superStatus) {
    return { level: "blocks", text: "Pick the status to move the job to" };
  }

  const parsed = actionSchema.safeParse(action);
  if (!parsed.success) {
    return { level: "blocks", text: parsed.error.issues[0]?.message ?? "This step is not finished" };
  }

  const to = action.to ?? "client";
  if (kind && !triggerHasJob(kind) && JOB_RECIPIENTS.has(to)) {
    return {
      level: "warns",
      text: `${RECIPIENT_LABEL[to]} comes off the job, and this trigger carries no job — this step would reach nobody.`,
    };
  }

  return undefined;
}
