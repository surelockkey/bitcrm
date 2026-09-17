"use client";

import {
  Clock,
  Copy,
  Filter,
  MessageSquare,
  MoreVertical,
  Repeat,
  Tag,
  ToggleRight,
  Trash2,
  TriangleAlert,
  Webhook,
  Zap,
} from "lucide-react";
import type { AutomationLabelMap } from "@bitcrm/types";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { nodeSummary } from "./node-panel";
import { KIND_LABEL, nodeIssue } from "./node-summary";
import type { ChainNode, ChainNodeKind } from "./types";

/**
 * The tile beside each card (spec §3). Our own colours, and ours are one
 * accent plus greys (`globals.css`) — no Workiz yellow, no Zapier orange, and
 * no five hues invented for five kinds. So the icon tells the kinds apart and
 * the tint only marks what a reader is actually scanning for: what starts the
 * rule, what it checks, what it does, and where it pauses.
 */
const KIND_STYLE: Record<ChainNodeKind, { Icon: typeof Zap; tile: string }> = {
  trigger: { Icon: Zap, tile: "bg-brand/10 text-brand" },
  condition: { Icon: Filter, tile: "bg-secondary text-secondary-foreground" },
  send: { Icon: MessageSquare, tile: "bg-primary/10 text-primary" },
  add_tag: { Icon: Tag, tile: "bg-primary/10 text-primary" },
  change_sub_status: { Icon: ToggleRight, tile: "bg-primary/10 text-primary" },
  webhook: { Icon: Webhook, tile: "bg-primary/10 text-primary" },
  wait: { Icon: Clock, tile: "bg-muted text-muted-foreground" },
};

const CIRCLED = ["①", "②", "③", "④", "⑤", "⑥", "⑦", "⑧", "⑨", "⑩"];

/** Workiz numbers its steps; past ten the digit is plainer than a glyph nobody has. */
const step = (index: number): string => CIRCLED[index - 1] ?? `${index}.`;

/**
 * One step of the chain (spec §3): the tile, the number and kind, the Workiz
 * sentence, and whatever is wrong with it. The whole card is one control that
 * opens the step's settings — a card that could only be reached by clicking a
 * word inside it would leave the chain unusable from a keyboard — with the `⋮`
 * sitting above it as the one other thing a card can do.
 */
export function AutomationNodeCard({
  node,
  index,
  chain,
  labels,
  selected,
  panelId,
  disabled,
  onSelect,
  onDuplicate,
  onDelete,
}: {
  node: ChainNode;
  /** 1-based, as the reader counts them. */
  index: number;
  chain: ChainNode[];
  labels: AutomationLabelMap;
  selected: boolean;
  /** The settings panel this card opens — the same region for every card. */
  panelId: string;
  disabled?: boolean;
  onSelect: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  const { Icon, tile } = KIND_STYLE[node.kind];
  const summary = nodeSummary(node, labels);
  const issue = nodeIssue(node, chain);
  const kind = KIND_LABEL[node.kind];
  const unfinished = issue?.level === "blocks";

  return (
    <div
      data-testid={`chain-node-${node.id}`}
      data-selected={selected || undefined}
      className={cn(
        "relative flex items-start gap-3 rounded-xl border bg-background p-3 text-left transition-colors",
        "has-[:focus-visible]:border-ring has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-ring/50",
        selected ? "border-brand ring-1 ring-brand/40" : "hover:bg-muted/40",
        // The reason `Save` is grey, on the card that can answer it (§3).
        unfinished ? "border-dashed border-amber-500/70" : null,
      )}
    >
      <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-lg", tile)} aria-hidden="true">
        <Icon className="size-4" />
      </span>

      <div className="min-w-0 flex-1">
        <p className="text-xs text-muted-foreground">
          <span aria-hidden="true">{step(index)} </span>
          {kind}
        </p>
        {/* The card's own control. `after:absolute inset-0` makes the whole
            card its hit area without nesting a button inside a button. */}
        <button
          type="button"
          aria-label={`Step ${index}, ${kind}: ${summary}`}
          aria-expanded={selected}
          aria-controls={panelId}
          onClick={onSelect}
          className="text-left text-sm font-medium outline-none after:absolute after:inset-0 after:rounded-xl"
        >
          {summary}
        </button>
        {node.kind === "condition" ? (
          // Conditions are checked before anything is sent, wherever the card
          // was dropped in the chain (§1). Said plainly, or the order of the
          // cards is read as the order of events.
          <p className="mt-0.5 text-xs text-muted-foreground">checked before anything is sent</p>
        ) : null}
        {issue ? (
          <p
            className={cn(
              "mt-1 flex items-start gap-1.5 text-xs",
              issue.level === "blocks" ? "text-destructive" : "text-amber-600 dark:text-amber-500",
            )}
          >
            <TriangleAlert className="mt-px size-3.5 shrink-0" />
            {issue.text}
          </p>
        ) : null}
      </div>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            disabled={disabled}
            aria-label={`Actions for step ${index}`}
            className="relative z-10"
          >
            <MoreVertical />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-44">
          {node.kind === "trigger" ? (
            // A rule is its trigger: there is no rule without one and no
            // second one to duplicate it into. So the only thing to offer is
            // choosing a different one, which is what the panel is for.
            <DropdownMenuItem onClick={onSelect}>
              <Repeat />
              Replace
            </DropdownMenuItem>
          ) : (
            <>
              {node.kind === "wait" ? null : (
                <DropdownMenuItem onClick={onDuplicate}>
                  <Copy />
                  Duplicate
                </DropdownMenuItem>
              )}
              <DropdownMenuItem variant="destructive" onClick={onDelete}>
                <Trash2 />
                Delete
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
