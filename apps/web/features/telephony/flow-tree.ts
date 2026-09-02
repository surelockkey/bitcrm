import type { CallFlow, CallFlowNode, CallFlowNodeType } from "@bitcrm/types";
import { newStepId } from "./flow-graph";

/**
 * The editor's shape for a flow.
 *
 * Stored flows are a graph: every step names the step that follows it. That is
 * right for a runner and wrong for a person — it turns "what happens next" into
 * a dropdown, and the order you read on screen has nothing to do with the order
 * the call happens in.
 *
 * So the editor works on a tree instead. A sequence is what it looks like: the
 * steps of the call, in order. Branching steps own their own sequences, one per
 * exit. Dragging a step changes the call, because position *is* the wiring —
 * and `next` never has to be shown to anybody.
 */
export interface FlowStep {
  /** The step itself. Its `next` / branch targets are derived, never edited. */
  node: CallFlowNode;
  /** For a branching step: exit key → what happens down that exit. */
  branches?: Record<string, FlowStep[]>;
}

/** Exit keys for a branching step, in the order they should be shown. */
export function branchKeysOf(node: CallFlowNode): { key: string; label: string }[] {
  if (node.type === "ring") {
    // Ringing has two outcomes, and confusing them is how a closing message
    // ends up only being heard by callers nobody answered.
    return [
      { key: "answered", label: "After the call" },
      { key: "noAnswer", label: "If nobody answers" },
    ];
  }
  if (node.type === "hours") {
    return [
      { key: "open", label: "While open" },
      { key: "closed", label: "While closed" },
    ];
  }
  if (node.type === "menu") {
    return [
      ...node.options.map((option) => ({
        key: option.key,
        label: `Press ${option.key}${option.label ? ` · ${option.label}` : ""}`,
      })),
      { key: "timeout", label: "Presses nothing" },
    ];
  }
  if (node.type === "ext") {
    // Two outcomes, like ringing: a technician who connected, and one whose
    // code was never accepted — who must reach a person, not a dead end.
    return [
      { key: "answered", label: "After the call" },
      { key: "noAnswer", label: "If the code is not accepted" },
    ];
  }
  return [];
}

export function isBranching(type: CallFlowNodeType): boolean {
  return (
    type === "hours" || type === "menu" || type === "ring" || type === "ext"
  );
}

/* ------------------------------------------------------------ tree → graph */

/**
 * Flatten the editor's tree back into the stored graph, wiring `next` from the
 * order of each sequence.
 */
export function toGraph(steps: FlowStep[]): {
  entryNodeId: string;
  nodes: Record<string, CallFlowNode>;
} {
  const nodes: Record<string, CallFlowNode> = {};

  const walk = (sequence: FlowStep[]): string | undefined => {
    let firstId: string | undefined;
    let previous: CallFlowNode | undefined;

    for (const step of sequence) {
      const node = { ...step.node };
      nodes[node.id] = node;
      firstId ??= node.id;

      // Each step leads to the one drawn under it. The last leads nowhere,
      // which is how a sequence ends the call.
      if (previous) setMainExit(previous, node.id);
      previous = node;

      if (step.branches) {
        for (const [key, branch] of Object.entries(step.branches)) {
          const target = walk(branch);
          setBranchExit(node, key, target);
        }
        // A branching step's own `next` is a branch, so nothing after it on
        // this line can follow it — the branches are where the call goes.
        previous = undefined;
      }
    }
    if (previous) setMainExit(previous, undefined);
    return firstId;
  };

  const entryNodeId = walk(steps) ?? "";
  return { entryNodeId, nodes };
}

function setMainExit(node: CallFlowNode, next: string | undefined): void {
  // Branching steps have no main line — every exit is a branch.
  if (isBranching(node.type)) return;
  node.next = next;
}

function setBranchExit(
  node: CallFlowNode,
  key: string,
  target: string | undefined,
): void {
  if (node.type === "ring" || node.type === "ext") {
    if (key === "answered") node.answeredNext = target;
    else node.next = target;
    return;
  }
  if (node.type === "hours") {
    if (key === "open") node.openNext = target;
    else node.next = target;
    return;
  }
  if (node.type === "menu") {
    if (key === "timeout") {
      node.next = target;
      return;
    }
    node.options = node.options.map((option) =>
      option.key === key ? { ...option, next: target ?? "" } : option,
    );
  }
}

/* ------------------------------------------------------------ graph → tree */

const MAX_DEPTH = 40;

/**
 * Read a stored flow back into the editor's tree.
 *
 * A graph can share a step between two branches; a tree can't, so a shared
 * step is copied into each branch that reaches it. The caller's experience is
 * identical either way — the copy is what saving normalises it to.
 */
export function toTree(flow: Pick<CallFlow, "nodes" | "entryNodeId">): FlowStep[] {
  const build = (
    startId: string | undefined,
    seen: Set<string>,
    depth: number,
  ): FlowStep[] => {
    const sequence: FlowStep[] = [];
    let cursor = startId;

    while (cursor && depth < MAX_DEPTH) {
      const original = flow.nodes?.[cursor];
      if (!original) break;
      // A cycle would otherwise recurse forever; the server refuses to store
      // one, so this only guards against hand-edited data.
      if (seen.has(cursor)) break;
      const path = new Set(seen).add(cursor);

      const node: CallFlowNode = structuredClone(original);
      if (isBranching(node.type)) {
        const branches: Record<string, FlowStep[]> = {};
        for (const { key } of branchKeysOf(node)) {
          branches[key] = build(branchTarget(node, key), path, depth + 1);
        }
        sequence.push({ node, branches });
        break; // everything after a branch lives inside one
      }

      sequence.push({ node });
      cursor = node.next;
      seen = path;
    }
    return sequence;
  };

  return build(flow.entryNodeId, new Set(), 0);
}

function branchTarget(node: CallFlowNode, key: string): string | undefined {
  if (node.type === "ring" || node.type === "ext")
    return key === "answered" ? node.answeredNext : node.next;
  if (node.type === "hours") return key === "open" ? node.openNext : node.next;
  if (node.type === "menu") {
    if (key === "timeout") return node.next;
    return node.options.find((option) => option.key === key)?.next || undefined;
  }
  return undefined;
}

/* ---------------------------------------------------------------- editing */

/** Replace one step wherever it sits in the tree. */
export function replaceStep(
  steps: FlowStep[],
  id: string,
  update: (step: FlowStep) => FlowStep,
): FlowStep[] {
  return steps.map((step) => {
    if (step.node.id === id) return update(step);
    if (!step.branches) return step;
    return {
      ...step,
      branches: Object.fromEntries(
        Object.entries(step.branches).map(([key, branch]) => [
          key,
          replaceStep(branch, id, update),
        ]),
      ),
    };
  });
}

/**
 * Delete a step. Its branches' contents are dropped with it — they only ever
 * existed as its exits, and the confirm in the UI says so.
 */
export function deleteStep(steps: FlowStep[], id: string): FlowStep[] {
  return steps
    .filter((step) => step.node.id !== id)
    .map((step) =>
      step.branches
        ? {
            ...step,
            branches: Object.fromEntries(
              Object.entries(step.branches).map(([key, branch]) => [
                key,
                deleteStep(branch, id),
              ]),
            ),
          }
        : step,
    );
}

/**
 * Insert a step at a position in one sequence, addressed by its branch path.
 *
 * The canvas hangs a `+` on every connector, so "between these two" is the
 * common case, not the exception — appending only to the end would mean
 * rebuilding the tail of a flow to slot one greeting in front of it.
 */
export function insertStep(
  steps: FlowStep[],
  path: string[],
  index: number,
  step: FlowStep,
): FlowStep[] {
  if (path.length === 0) {
    const at = Math.max(0, Math.min(index, steps.length));
    const before = steps.slice(0, at);
    const after = steps.slice(at);

    // A branching step has no main line — `toGraph` gives it only its exits —
    // so anything that followed would simply stop happening. What the person
    // meant is that the call carries on down the primary path, so the tail
    // moves into the step's first exit.
    const keys = step.branches ? branchKeysOf(step.node) : [];
    if (after.length && keys.length) {
      const primary = keys[0].key;
      return [
        ...before,
        {
          ...step,
          branches: { ...step.branches, [primary]: [...(step.branches?.[primary] ?? []), ...after] },
        },
      ];
    }
    return [...before, step, ...after];
  }
  const [ownerId, branchKey, ...rest] = path;
  return steps.map((current) => {
    if (current.node.id !== ownerId || !current.branches) return current;
    return {
      ...current,
      branches: {
        ...current.branches,
        [branchKey]: insertStep(
          current.branches[branchKey] ?? [],
          rest,
          index,
          step,
        ),
      },
    };
  });
}

/** Insert a step at the end of one sequence, addressed by its branch path. */
export function appendStep(
  steps: FlowStep[],
  path: string[],
  step: FlowStep,
): FlowStep[] {
  return insertStep(steps, path, Number.MAX_SAFE_INTEGER, step);
}

/** Move a step within its own sequence, addressed by branch path. */
export function reorder(
  steps: FlowStep[],
  path: string[],
  from: number,
  to: number,
): FlowStep[] {
  if (path.length === 0) return move(steps, from, to);
  const [ownerId, branchKey, ...rest] = path;
  return steps.map((current) => {
    if (current.node.id !== ownerId || !current.branches) return current;
    return {
      ...current,
      branches: {
        ...current.branches,
        [branchKey]: reorder(current.branches[branchKey] ?? [], rest, from, to),
      },
    };
  });
}

function move<T>(list: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) {
    return list;
  }
  const out = [...list];
  const [item] = out.splice(from, 1);
  out.splice(to, 0, item);
  return out;
}

/** A fresh step of this type, with a sequence for each exit it has. */
export function newStep(type: CallFlowNodeType, node: CallFlowNode): FlowStep {
  const withId = { ...node, id: node.id || newStepId(type) };
  if (!isBranching(type)) return { node: withId };
  return {
    node: withId,
    branches: Object.fromEntries(branchKeysOf(withId).map(({ key }) => [key, []])),
  };
}
