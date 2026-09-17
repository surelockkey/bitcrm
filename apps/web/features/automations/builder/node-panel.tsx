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
 * The contract name for the one line a card shows. It is the chain's own
 * summary — one implementation, so the card, the panel and the rules list
 * cannot say the same rule three different ways.
 */
import { chainNodeSummary } from "./node-summary";
export { chainNodeSummary as nodeSummary } from "./node-summary";


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
        <p className="text-xs text-muted-foreground">{chainNodeSummary(node, labels)}</p>
      </header>
      {body()}
    </div>
  );
}
