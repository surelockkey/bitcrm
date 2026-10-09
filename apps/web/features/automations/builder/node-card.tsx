"use client";

import type { ReactNode } from "react";
import { Copy, Repeat, Trash2, TriangleAlert } from "lucide-react";
import type { AutomationLabelMap } from "@bitcrm/types";
import { WzDotsMenu, type WzDotsMenuItem } from "@/components/workiz/dots-menu";
import { cn } from "@/lib/utils";
import { conditionLineParts, sentenceParts } from "../sentence-slots";
import { SentenceParts } from "../components/automation-sentence";
import { nodeSummary } from "./node-panel";
import { KIND_LABEL, nodeIssue } from "./node-summary";
import type { ChainNode } from "./types";

/** Where a step sits in the chain — what its share of the dashed connector looks like. */
export type StepPosition = "only" | "first" | "middle" | "last";

/**
 * A step "says" a line of the rule in one of Workiz's two sizes
 * (pg_automations_wz_31_edit): the trigger and what the rule does are the big
 * sentence — 32px/48px, a 28px bullet, 48px between lines; a check ("Only
 * if …") and our wait are the small line under it — 16px/30px white, a 10px
 * white dot, 22px between lines.
 */
export const isBigLine = (node: ChainNode) => node.kind !== "condition" && node.kind !== "wait";

/** The bullet's centre, down from the top of its line: half of 48px, or half of 30px. */
const centreOf = (node: ChainNode) => (isBigLine(node) ? 24 : 15);

/** Workiz's `ruleBullet`: a 28px #566d76 tile, 8px corners, with a 14px ring in it. */
function Bullet({ state }: { state: "open" | "done" | "start" | "empty" }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "mt-2.5 flex size-7 shrink-0 items-center justify-center rounded-[8px]",
        state === "open" ? "bg-wz-tag-success" : "bg-wz-slate",
      )}
    >
      <span
        className={cn(
          "size-3.5 rounded-full border-2",
          state === "open" && "border-white bg-white",
          state === "done" && "border-wz-tag-success bg-wz-tag-success",
          state === "start" && "border-wz-tag-success",
          state === "empty" && "border-wz-outline",
        )}
      />
    </span>
  );
}

/**
 * The dashed connector (Workiz's `sentenceSection` link): one #9ea6aa dashed
 * line down the left from the first bullet to the last, a stub into every
 * bullet ending in a 5×6 arrowhead, the corners at either end rounded 4px.
 */
function Connector({ position, centre }: { position: StepPosition; centre: number }) {
  if (position === "only") return null;
  return (
    <>
      <span
        aria-hidden="true"
        className={cn(
          "absolute left-0 w-[19px] border-l border-dashed border-wz-outline",
          position === "first" && "bottom-0 rounded-tl-[4px] border-t",
          position === "middle" && "inset-y-0",
          position === "last" && "top-0 rounded-bl-[4px] border-b",
        )}
        style={
          position === "first"
            ? { top: centre }
            : position === "last"
              ? { height: centre + 1 }
              : undefined
        }
      />
      {position === "middle" ? (
        <span aria-hidden="true" className="absolute left-0 w-[19px] border-t border-dashed border-wz-outline" style={{ top: centre }} />
      ) : null}
      {/* The arrowhead at the stub's end, pointing into the bullet. */}
      <span
        aria-hidden="true"
        className="absolute left-[15px] size-0 border-y-[3px] border-l-[5px] border-y-transparent border-l-wz-outline"
        style={{ top: centre - 3 }}
      />
    </>
  );
}

/**
 * One step of the chain, drawn as a line of Workiz's builder: the bullet, the
 * sentence (its picked parts white and underlined, the glue #9ea6aa), and our
 * ••• at the right where Workiz keeps its trash can. The sentence is the
 * step's own control — it opens the step's settings under the line, the way a
 * Workiz slot opens its menu under the word — and `children` is where those
 * settings go. A step that cannot be saved yet says why under its line.
 */
export function AutomationNodeCard({
  node,
  index,
  chain,
  labels,
  selected,
  panelId,
  disabled,
  position,
  onSelect,
  onDuplicate,
  onDelete,
  children,
}: {
  node: ChainNode;
  /** 1-based, as the reader counts them. */
  index: number;
  chain: ChainNode[];
  labels: AutomationLabelMap;
  selected: boolean;
  /** The settings region this line opens — the same id whichever line is open. */
  panelId: string;
  disabled?: boolean;
  position: StepPosition;
  onSelect: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  children?: ReactNode;
}) {
  const summary = nodeSummary(node, labels);
  const issue = nodeIssue(node, chain);
  const kind = KIND_LABEL[node.kind];
  const unfinished = issue?.level === "blocks";
  const big = isBigLine(node);
  // What the rule does reads on from its "When …" line, as Workiz writes it:
  // "send someone a text and email", lower-case — an invitation keeps its capital.
  const shown =
    big && node.kind !== "trigger" && !/^Choose\b/.test(summary) ? summary.charAt(0).toLowerCase() + summary.slice(1) : summary;

  const items: WzDotsMenuItem[] =
    node.kind === "trigger"
      ? // A rule is its trigger: there is no rule without one and no second
        // one to duplicate it into — the only thing to offer is another one.
        [{ key: "replace", label: "Replace", icon: <Repeat strokeWidth={1.5} />, onSelect }]
      : [
          ...(node.kind === "wait"
            ? []
            : [{ key: "duplicate", label: "Duplicate", icon: <Copy strokeWidth={1.5} />, onSelect: onDuplicate }]),
          { key: "delete", label: "Delete", icon: <Trash2 strokeWidth={1.5} />, onSelect: onDelete, destructive: true },
        ];

  return (
    <div
      data-testid={`chain-node-${node.id}`}
      data-selected={selected || undefined}
      className={cn("relative pl-[23px]", big ? "pb-12" : "pb-[22px]")}
    >
      <Connector position={position} centre={centreOf(node)} />
      <div className="flex items-start gap-6">
        {big ? (
          <Bullet state={selected ? "open" : unfinished ? (node.kind === "trigger" ? "start" : "empty") : "done"} />
        ) : (
          <span aria-hidden="true" className="flex w-7 shrink-0 justify-center pt-[10px]">
            <span className="size-2.5 rounded-full bg-white" />
          </span>
        )}
        <div className="min-w-0 flex-1">
          <button
            type="button"
            // How the chain finds this line again after the list has changed
            // under it — see the focus handling in `automation-builder`.
            data-step-card={node.id}
            aria-label={`Step ${index}, ${kind}: ${summary}`}
            aria-expanded={selected}
            aria-controls={panelId}
            onClick={onSelect}
            className={cn(
              "group/line cursor-pointer text-left outline-none focus-visible:ring-2 focus-visible:ring-wz-focus",
              "[&:hover_[data-sentence-slot]]:text-[#a6e9c4]",
              selected && "[&_[data-sentence-slot]]:text-[#a6e9c4]",
              big
                ? "text-[32px] leading-[48px] tracking-[0.2px] text-wz-outline"
                : "text-base leading-[30px] tracking-[0.4px] text-white",
            )}
          >
            {node.kind === "condition" ? (
              <SentenceParts parts={conditionLineParts(summary)} tone="condition" />
            ) : (
              <SentenceParts parts={sentenceParts(shown)} tone={big ? "builder" : "condition"} />
            )}
          </button>
          {node.kind === "condition" ? (
            // Conditions are checked before anything is sent, wherever the line
            // was dropped in the chain. Said plainly, or the order of the lines
            // is read as the order of events.
            <p className="text-xs leading-4 tracking-[0.4px] text-wz-outline">checked before anything is sent</p>
          ) : null}
          {issue ? (
            <p
              className={cn(
                "mt-1 flex items-start gap-1.5 text-[13px] leading-[19px] tracking-[0.4px]",
                issue.level === "blocks" ? "text-[#ff8a75]" : "text-[#f5ba45]",
              )}
            >
              <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
              {issue.text}
            </p>
          ) : null}
        </div>
        <WzDotsMenu
          tone="light"
          aria-label={`Actions for step ${index}`}
          items={items}
          disabled={disabled}
          className={big ? "mt-3.5" : "mt-[5px]"}
        />
      </div>
      {children}
    </div>
  );
}
