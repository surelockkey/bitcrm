import type {
  CallFlow,
  CallFlowNode,
  CallFlowNodeType,
  HoursNode,
  MenuNode,
} from "@bitcrm/types";

/** Every step this one can lead to — `next` plus whatever branches it has. */
export function exitsOf(node: CallFlowNode): string[] {
  const exits: (string | undefined)[] = [node.next];
  if (node.type === "ring") exits.push(node.answeredNext);
  if (node.type === "hours") exits.push(node.openNext);
  if (node.type === "menu") exits.push(...node.options.map((o) => o.next));
  return exits.filter((id): id is string => !!id);
}

/**
 * The steps in the order a call meets them.
 *
 * Depth-first from the entry, so an hours split shows its open branch under
 * it and a menu shows its keys under theirs — which is how the call actually
 * reads. Steps nothing points at are appended, because an orphan the editor
 * hid would be impossible to delete.
 */
export function orderedSteps(
  flow: Pick<CallFlow, "nodes" | "entryNodeId">,
): Array<{ node: CallFlowNode; depth: number; branch?: string }> {
  const out: Array<{ node: CallFlowNode; depth: number; branch?: string }> = [];
  const seen = new Set<string>();

  const walk = (id: string, depth: number, branch?: string) => {
    const node = flow.nodes[id];
    if (!node || seen.has(id)) return;
    seen.add(id);
    out.push({ node, depth, branch });

    if (node.type === "hours") {
      if (node.openNext) walk(node.openNext, depth + 1, "Open");
      if (node.next) walk(node.next, depth + 1, "Closed");
      return;
    }
    if (node.type === "menu") {
      for (const option of node.options) {
        walk(option.next, depth + 1, `Press ${option.key}`);
      }
      if (node.next) walk(node.next, depth + 1, "No answer");
      return;
    }
    if (node.next) walk(node.next, depth, undefined);
  };

  walk(flow.entryNodeId, 0);
  for (const node of Object.values(flow.nodes)) {
    if (!seen.has(node.id)) out.push({ node, depth: 0, branch: "Not reachable" });
  }
  return out;
}

export const STEP_LABEL: Record<CallFlowNodeType, string> = {
  say: "Say something",
  hours: "Business hours",
  menu: "Voice menu",
  ring: "Ring a group",
  voicemail: "Take a message",
  hangup: "Hang up",
};

let counter = 0;
/** Ids only have to be unique inside one flow, and readable in the editor. */
export function newStepId(type: CallFlowNodeType): string {
  counter += 1;
  return `${type}-${Date.now().toString(36)}${counter}`;
}

const DEFAULT_HOURS: Omit<HoursNode, "id" | "type"> = {
  timezone:
    typeof Intl !== "undefined"
      ? Intl.DateTimeFormat().resolvedOptions().timeZone
      : "America/New_York",
  windows: [1, 2, 3, 4, 5].map((day) => ({ day, open: "08:00", close: "18:00" })),
  holidays: [],
};

const DEFAULT_MENU: Omit<MenuNode, "id" | "type"> = {
  prompt: "Press 1 for a new job, 2 for an existing one.",
  options: [],
  timeoutSeconds: 5,
  repeats: 1,
};

export function blankStep(type: CallFlowNodeType): CallFlowNode {
  const id = newStepId(type);
  switch (type) {
    case "say":
      return { id, type, text: "" };
    case "hours":
      return { id, type, ...DEFAULT_HOURS };
    case "menu":
      return { id, type, ...DEFAULT_MENU };
    case "ring":
      return { id, type, groupId: "" };
    case "voicemail":
      return {
        id,
        type,
        prompt: "Please leave a message after the tone.",
        maxSeconds: 120,
      };
    case "hangup":
      return { id, type };
  }
}

/**
 * Remove a step and heal what pointed at it, so deleting the middle of a flow
 * doesn't break the chain around it.
 */
export function removeStep(
  nodes: Record<string, CallFlowNode>,
  id: string,
): Record<string, CallFlowNode> {
  const target = nodes[id];
  const heir = target ? exitsOf(target)[0] : undefined;
  const out: Record<string, CallFlowNode> = {};

  for (const node of Object.values(nodes)) {
    if (node.id === id) continue;
    const repoint = (to?: string) => (to === id ? heir : to);
    if (node.type === "hours") {
      out[node.id] = { ...node, next: repoint(node.next), openNext: repoint(node.openNext) };
    } else if (node.type === "menu") {
      out[node.id] = {
        ...node,
        next: repoint(node.next),
        options: node.options
          .map((o) => ({ ...o, next: repoint(o.next) }))
          .filter((o): o is typeof o & { next: string } => !!o.next),
      };
    } else {
      out[node.id] = { ...node, next: repoint(node.next) };
    }
  }
  return out;
}
