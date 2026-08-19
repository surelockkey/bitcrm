import { describe, it, expect } from "vitest";
import type {
  CallFlow,
  CallFlowNode,
  HoursNode,
  MenuNode,
  SayNode,
} from "@bitcrm/types";
import {
  appendStep,
  branchKeysOf,
  deleteStep,
  newStep,
  reorder,
  replaceStep,
  toGraph,
  toTree,
  type FlowStep,
} from "./flow-tree";

const say = (id: string, text = "hi"): SayNode => ({ id, type: "say", text });
const ring = (id: string, groupId = "g1"): CallFlowNode => ({ id, type: "ring", groupId });
const hangup = (id: string): CallFlowNode => ({ id, type: "hangup" });
const hours = (id: string): HoursNode => ({
  id, type: "hours", timezone: "UTC",
  windows: [{ day: 1, open: "08:00", close: "18:00" }],
});
const menu = (id: string, keys: string[]): MenuNode => ({
  id, type: "menu", prompt: "Press.",
  options: keys.map((key) => ({ key, label: "", next: "" })),
  timeoutSeconds: 5, repeats: 1,
});

const flowOf = (nodes: CallFlowNode[], entryNodeId: string): Pick<CallFlow, "nodes" | "entryNodeId"> => ({
  entryNodeId,
  nodes: Object.fromEntries(nodes.map((n) => [n.id, n])),
});

describe("flow-tree — order is the wiring", () => {
  it("chains a straight sequence in the order it is drawn", () => {
    const graph = toGraph([{ node: say("a") }, { node: ring("b") }, { node: hangup("c") }]);

    expect(graph.entryNodeId).toBe("a");
    expect(graph.nodes.a.next).toBe("b");
    expect(graph.nodes.b.next).toBe("c");
    // The last step ends the call — that is what "no next" means.
    expect(graph.nodes.c.next).toBeUndefined();
  });

  it("reordering the list really reorders the call", () => {
    const before: FlowStep[] = [{ node: say("a") }, { node: ring("b") }];
    const after = reorder(before, [], 0, 1);

    expect(toGraph(after).entryNodeId).toBe("b");
    expect(toGraph(after).nodes.b.next).toBe("a");
  });

  it("wires an hours split from its two branches", () => {
    const tree: FlowStep[] = [
      {
        node: hours("h"),
        branches: { open: [{ node: ring("r") }], closed: [{ node: hangup("x") }] },
      },
    ];

    const graph = toGraph(tree);

    expect(graph.nodes.h).toMatchObject({ openNext: "r", next: "x" });
  });

  it("wires each menu key, and the caller who presses nothing", () => {
    const tree: FlowStep[] = [
      {
        node: menu("m", ["1", "2"]),
        branches: {
          "1": [{ node: ring("r1") }],
          "2": [{ node: ring("r2") }],
          timeout: [{ node: hangup("t") }],
        },
      },
    ];

    const wired = toGraph(tree).nodes.m as MenuNode;

    expect(wired.options.map((o) => o.next)).toEqual(["r1", "r2"]);
    expect(wired.next).toBe("t");
  });

  it("leaves an empty branch ending the call rather than pointing at nothing", () => {
    const tree: FlowStep[] = [
      { node: hours("h"), branches: { open: [{ node: ring("r") }], closed: [] } },
    ];

    const graph = toGraph(tree);

    expect(graph.nodes.h).toMatchObject({ openNext: "r", next: undefined });
  });

  it("round-trips a branching flow back into the same tree", () => {
    const original: FlowStep[] = [
      { node: say("greet") },
      {
        node: hours("h"),
        branches: {
          open: [{ node: ring("r") }, { node: hangup("bye") }],
          closed: [{ node: hangup("shut") }],
        },
      },
    ];

    const graph = toGraph(original);
    const back = toTree(graph);

    expect(back.map((s) => s.node.id)).toEqual(["greet", "h"]);
    expect(back[1].branches?.open.map((s) => s.node.id)).toEqual(["r", "bye"]);
    expect(back[1].branches?.closed.map((s) => s.node.id)).toEqual(["shut"]);
  });

  it("reads a hand-written graph, copying a step two branches share", () => {
    // A tree cannot share a step; the caller's experience is the same either way.
    const shared = flowOf(
      [
        { ...hours("h"), openNext: "vm", next: "vm" },
        { id: "vm", type: "voicemail", prompt: "Message.", maxSeconds: 60 },
      ],
      "h",
    );

    const tree = toTree(shared);

    expect(tree[0].branches?.open[0].node.id).toBe("vm");
    expect(tree[0].branches?.closed[0].node.id).toBe("vm");
  });

  it("does not hang on a flow that loops", () => {
    const looped = flowOf([{ ...say("a"), next: "a" }], "a");
    expect(toTree(looped).map((s) => s.node.id)).toEqual(["a"]);
  });

  it("stops at a step that has been deleted from under it", () => {
    const dangling = flowOf([{ ...say("a"), next: "ghost" }], "a");
    expect(toTree(dangling).map((s) => s.node.id)).toEqual(["a"]);
  });

  describe("editing", () => {
    const tree: FlowStep[] = [
      { node: say("a") },
      {
        node: hours("h"),
        branches: { open: [{ node: ring("r") }], closed: [{ node: hangup("x") }] },
      },
    ];

    it("edits a step nested inside a branch", () => {
      const updated = replaceStep(tree, "r", (step) => ({
        ...step,
        node: { ...step.node, id: "r", type: "ring", groupId: "g2" } as CallFlowNode,
      }));

      expect(updated[1].branches?.open[0].node).toMatchObject({ groupId: "g2" });
    });

    it("deletes a nested step without touching its siblings", () => {
      const updated = deleteStep(tree, "x");

      expect(updated[1].branches?.closed).toEqual([]);
      expect(updated[1].branches?.open).toHaveLength(1);
    });

    it("appends to the end of a named branch", () => {
      const updated = appendStep(tree, ["h", "open"], { node: hangup("new") });

      expect(updated[1].branches?.open.map((s) => s.node.id)).toEqual(["r", "new"]);
    });

    it("reorders inside a branch, not the top level", () => {
      const two = appendStep(tree, ["h", "open"], { node: hangup("second") });
      const swapped = reorder(two, ["h", "open"], 0, 1);

      expect(swapped[1].branches?.open.map((s) => s.node.id)).toEqual(["second", "r"]);
      expect(swapped.map((s) => s.node.id)).toEqual(["a", "h"]);
    });
  });

  it("gives a new branching step one empty sequence per exit", () => {
    const step = newStep("menu", menu("m", ["1", "2"]));
    expect(Object.keys(step.branches ?? {})).toEqual(["1", "2", "timeout"]);
  });

  it("names each exit the way it will be read on screen", () => {
    expect(branchKeysOf(hours("h")).map((b) => b.label)).toEqual([
      "While open",
      "While closed",
    ]);
    const withLabels: MenuNode = {
      ...menu("m", ["1"]),
      options: [{ key: "1", label: "Dispatch", next: "" }],
    };
    expect(branchKeysOf(withLabels)[0].label).toBe("Press 1 · Dispatch");
  });
});
