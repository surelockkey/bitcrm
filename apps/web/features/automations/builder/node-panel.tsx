"use client";

import type { ReactElement } from "react";
import {
  automationActionSentence,
  automationConditionsSentence,
  automationDelayText,
  automationTriggerSentence,
  type AutomationLabelMap,
  type AutomationSpec,
} from "@bitcrm/types";
import { SUPER_STATUS_LABEL } from "../lib";
import type { ChainNode, ChainNodeKind } from "./types";
import { ConditionPanel } from "./panels/condition-panel";
import { SendPanel } from "./panels/send-panel";
import { SubStatusPanel, TagPanel } from "./panels/tag-panel";
import { TriggerPanel } from "./panels/trigger-panel";
import { WaitPanel } from "./panels/wait-panel";
import { WebhookPanel } from "./panels/webhook-panel";

export interface NodePanelProps {
  node: ChainNode;
  labels: AutomationLabelMap;
  /** The whole chain, read-only — a panel may need to know the trigger to offer the right fields. */
  chain: ChainNode[];
  onChange: (next: ChainNode) => void;
  disabled?: boolean;
}

/** What each step is called, wherever it is named: the panel's heading and the "+" menu. */
export const PANEL_TITLE: Record<ChainNodeKind, string> = {
  trigger: "Trigger",
  condition: "Only if",
  send: "Send a message",
  add_tag: "Apply a tag",
  change_sub_status: "Change the sub-status",
  webhook: "Post a webhook",
  wait: "Wait",
};

/** What a step with nothing filled in asks for, on its card and in its panel. */
const PROMPT: Record<ChainNodeKind, string> = {
  trigger: "Choose a trigger",
  condition: "Choose what to check",
  send: "Choose what to do",
  add_tag: "Choose a tag",
  change_sub_status: "Choose a status",
  webhook: "Choose where to post",
  wait: "Choose how long to wait",
};

const capitalise = (text: string): string => (text ? text[0].toUpperCase() + text.slice(1) : text);

/**
 * The names a sentence is read with. The super-status names are the floor —
 * without them a card says "a status of canceled" — and anything the caller
 * knows wins over them, exactly as `specSentence` does it for the rules list,
 * so a step's line here and the rule's line there cannot drift apart.
 */
const named = (labels: AutomationLabelMap): AutomationLabelMap => ({ ...SUPER_STATUS_LABEL, ...labels });

/**
 * One line describing a node, for its card.
 *
 * Every word of it comes from `packages/types` — `automationTriggerSentence`,
 * `automationConditionsSentence`, `automationActionSentence` — the same three
 * functions the rules list, the API and the firing log read. A second
 * phrasing written here would drift from the cards on the list within a week,
 * and then the same rule would read two different ways on two screens.
 */
export function nodeSummary(node: ChainNode, labels: AutomationLabelMap): string {
  const names = named(labels);
  switch (node.kind) {
    case "trigger":
      if (!node.trigger) return PROMPT.trigger;
      return automationTriggerSentence({ version: 1, trigger: node.trigger, actions: [] }, names);

    case "condition": {
      if (!node.condition) return PROMPT.condition;
      // The one place a condition is put into words reads a whole spec, so it
      // is handed a spec of just this condition. Its trigger is `deal.created`
      // deliberately: that is the one kind that speaks for no condition at
      // all, so nothing is dropped here as "the trigger already said it".
      const spec: AutomationSpec = {
        version: 1,
        trigger: { kind: "deal.created" },
        conditions: [node.condition],
        actions: [],
      };
      const clause = automationConditionsSentence(spec, names).replace(/^\s*and\s+/, "");
      return clause ? capitalise(clause) : PROMPT.condition;
    }

    case "wait":
      return node.waitMinutes ? capitalise(automationDelayText(node.waitMinutes)) : PROMPT.wait;

    default: {
      const action = node.action;
      if (!action) return PROMPT[node.kind];
      // The sentence builder answers for a half-written action ("add the
      // tag", "post a webhook to a URL"); a card wants the invitation instead.
      if (node.kind === "add_tag" && !action.tagId) return PROMPT.add_tag;
      if (node.kind === "change_sub_status" && !action.subStatusId && !action.superStatus) {
        return PROMPT.change_sub_status;
      }
      if (node.kind === "webhook" && !action.url) return PROMPT.webhook;
      return capitalise(automationActionSentence(action, names));
    }
  }
}

/**
 * What opens when a step of the chain is selected — the place a rule is
 * actually written (§5).
 *
 * Each panel reads its node and writes the whole node back through
 * `onChange`; none of them keeps a copy of the rule. What little state they
 * do hold is about the panel rather than the rule (a disclosure that is open,
 * the message window), and it is rebuilt per node by the `key` below, so
 * selecting a step always shows what that step has actually got saved on it.
 */
export function NodePanel({ node, labels, chain, onChange, disabled }: NodePanelProps): ReactElement {
  const body = () => {
    switch (node.kind) {
      case "trigger":
        return <TriggerPanel node={node} labels={labels} onChange={onChange} disabled={disabled} />;
      case "condition":
        return <ConditionPanel node={node} labels={labels} onChange={onChange} disabled={disabled} />;
      case "send":
        return <SendPanel node={node} chain={chain} onChange={onChange} disabled={disabled} />;
      case "add_tag":
        return <TagPanel node={node} labels={labels} onChange={onChange} disabled={disabled} />;
      case "change_sub_status":
        return <SubStatusPanel node={node} labels={labels} onChange={onChange} disabled={disabled} />;
      case "webhook":
        return <WebhookPanel node={node} onChange={onChange} disabled={disabled} />;
      case "wait":
        return <WaitPanel node={node} onChange={onChange} disabled={disabled} />;
      default:
        return null;
    }
  };

  return (
    <div key={node.id} className="space-y-4">
      <header className="space-y-1">
        <h3 className="text-sm font-semibold">{PANEL_TITLE[node.kind]}</h3>
        <p className="text-xs text-muted-foreground">{nodeSummary(node, labels)}</p>
      </header>
      {body()}
    </div>
  );
}
