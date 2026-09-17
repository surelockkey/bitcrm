"use client";

import type { AutomationLabelMap } from "@bitcrm/types";
import { KIND_LABEL, chainNodeSummary } from "./node-summary";
import type { ChainNode } from "./types";

/**
 * PLACEHOLDER — the settings panel of the selected node (spec §5) is written
 * in parallel and lands here whole: the Workiz slots and popovers, the message
 * editor behind `Preview/edit message`, the condition's `+ Add 'or' condition`.
 * Only the contract the chain renders it by is fixed here, so the chain can be
 * built and tested against the real signature.
 */
export interface NodePanelProps {
  node: ChainNode;
  labels: AutomationLabelMap;
  /** The whole chain, read-only — a panel may need to know the trigger to offer the right fields. */
  chain: ChainNode[];
  onChange: (next: ChainNode) => void;
  disabled?: boolean;
}

export function NodePanel({ node, labels }: NodePanelProps): React.ReactElement {
  return (
    <p className="text-sm text-muted-foreground">
      {KIND_LABEL[node.kind]}: {chainNodeSummary(node, labels)}
    </p>
  );
}

/**
 * One line describing a node, for its card. Used by the chain stream.
 *
 * The implementation is `chainNodeSummary`, which is built on the sentence
 * builders in `automation-spec.ts` — re-exported rather than written twice so
 * this file can be replaced by the real panel without the cards losing theirs.
 */
export function nodeSummary(node: ChainNode, labels: AutomationLabelMap): string {
  return chainNodeSummary(node, labels);
}
