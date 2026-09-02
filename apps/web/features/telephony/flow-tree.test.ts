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
  insertStep,
  branchKeysOf,
  deleteStep,
  isBranching,
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
    const graph = toGraph([{ node: say("a") }, { node: say("b") }, { node: hangup("c") }]);

    expect(graph.entryNodeId).toBe("a");
    expect(graph.nodes.a.next).toBe("b");
    expect(graph.nodes.b.next).toBe("c");
    // The last step ends the call — that is what "no next" means.
    expect(graph.nodes.c.next).toBeUndefined();
  });

  it("reordering the list really reorders the call", () => {
    const before: FlowStep[] = [{ node: say("a") }, { node: say("b") }];
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
          open: [
            {
              node: ring("r"),
              branches: {
                answered: [{ node: say("bye", "Thanks for calling.") }],
                noAnswer: [{ node: hangup("miss") }],
              },
            },
          ],
          closed: [{ node: hangup("shut") }],
        },
      },
    ];

    const back = toTree(toGraph(original));

    expect(back.map((s) => s.node.id)).toEqual(["greet", "h"]);
    const openBranch = back[1].branches?.open ?? [];
    expect(openBranch.map((s) => s.node.id)).toEqual(["r"]);
    // Both outcomes of ringing survive the round trip, and stay apart.
    expect(openBranch[0].branches?.answered.map((s) => s.node.id)).toEqual(["bye"]);
    expect(openBranch[0].branches?.noAnswer.map((s) => s.node.id)).toEqual(["miss"]);
  });

  it("keeps a closing message apart from what happens on no answer", () => {
    // The bug this models: a message added after a ring was only ever heard by
    // callers nobody picked up for.
    const graph = toGraph([
      {
        node: ring("r"),
        branches: {
          answered: [{ node: say("thanks", "Thanks for calling.") }],
          noAnswer: [{ node: say("sorry", "Sorry we missed you.") }],
        },
      },
    ]);

    expect(graph.nodes.r).toMatchObject({ answeredNext: "thanks", next: "sorry" });
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

    /**
     * The canvas puts a `+` on every connector, so a step is added *between*
     * two others as often as after them — appending only to the end would
     * mean rebuilding the tail of a flow to slot one greeting in.
     */
    it("inserts at a position rather than only at the end", () => {
      const steps = [{ node: say("a") }, { node: say("c") }];
      const after = insertStep(steps, [], 1, { node: say("b") });

      expect(after.map((s) => s.node.id)).toEqual(["a", "b", "c"]);
    });

    it("inserts at the very front, before the step that used to be first", () => {
      const steps = [{ node: say("a") }];
      const after = insertStep(steps, [], 0, { node: say("greeting") });

      expect(after.map((s) => s.node.id)).toEqual(["greeting", "a"]);
    });

    it("inserts into a named branch at the given position", () => {
      const steps = [
        { node: hours("h"), branches: { open: [{ node: say("o") }], closed: [] } },
      ];
      const after = insertStep(steps, ["h", "open"], 0, { node: say("first") });

      expect(after[0].branches?.open.map((s) => s.node.id)).toEqual(["first", "o"]);
      expect(after[0].branches?.closed).toEqual([]);
    });

    it("wires an inserted step into the call it was dropped into", () => {
      const steps = [{ node: say("a") }, { node: say("c") }];
      const { nodes } = toGraph(insertStep(steps, [], 1, { node: say("b") }));

      expect(nodes.a.next).toBe("b");
      expect(nodes.b.next).toBe("c");
      expect(nodes.c.next).toBeUndefined();
    });

    /**
     * Dropping a branching step in front of existing steps used to strand
     * them: `toGraph` gives a branching step no main line, so everything
     * after it became unreachable and silently stopped happening. What the
     * person meant is that the call carries on down the primary path.
     */
    it("adopts what followed into the first branch of an inserted split", () => {
      const steps = [{ node: say("a") }, { node: say("b") }];
      const after = insertStep(steps, [], 0, newStep("hours", hours("h")));

      expect(after.map((s) => s.node.id)).toEqual(["h"]);
      expect(after[0].branches?.open.map((s) => s.node.id)).toEqual(["a", "b"]);
      expect(after[0].branches?.closed).toEqual([]);
    });

    it("keeps the adopted steps wired, rather than orphaning them", () => {
      const steps = [{ node: say("a") }, { node: say("b") }];
      const { entryNodeId, nodes } = toGraph(
        insertStep(steps, [], 0, newStep("hours", hours("h"))),
      );

      expect(entryNodeId).toBe("h");
      expect((nodes.h as HoursNode).openNext).toBe("a");
      expect(nodes.a.next).toBe("b");
    });

    it("has nothing to adopt when the split goes on the end", () => {
      const steps = [{ node: say("a") }];
      const after = insertStep(steps, [], 1, newStep("hours", hours("h")));

      expect(after.map((s) => s.node.id)).toEqual(["a", "h"]);
      expect(after[1].branches?.open).toEqual([]);
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

/**
 * The technician-line step is BRANCHING: a technician who connected and one
 * whose code was never accepted go different ways. A branching node missing
 * from these helpers has its exits silently erased the first time somebody
 * opens the flow and saves it — no error, no warning, just a broken line.
 */
describe("flow-tree — the ext step", () => {
  const ext = (over: Partial<Record<string, unknown>> = {}) =>
    ({
      id: "ext-1",
      type: "ext" as const,
      prompt: "Code?",
      confirmPrompt: "Calling",
      repeats: 3,
      timeoutSeconds: 10,
      ...over,
    }) as never;

  it("counts as branching", () => {
    expect(isBranching("ext")).toBe(true);
  });

  it("offers both outcomes as exits", () => {
    expect(branchKeysOf(ext()).map((b) => b.key)).toEqual([
      "answered",
      "noAnswer",
    ]);
  });

  /**
   * The regression that matters: round-tripping the flow through the editor
   * must preserve both exits.
   */
  it("survives a tree → graph → tree round trip with its exits intact", () => {
    const nodes: Record<string, never> = {
      "ext-1": ext({ answeredNext: "bye", next: "dispatch" }),
      dispatch: { id: "dispatch", type: "ring", groupId: "g1" } as never,
      bye: { id: "bye", type: "hangup" } as never,
    };

    const tree = toTree({ nodes, entryNodeId: "ext-1" });
    const graph = toGraph(tree);

    expect(graph.entryNodeId).toBe("ext-1");
    const back = graph.nodes["ext-1"] as { answeredNext?: string; next?: string };
    expect(back.answeredNext).toBe("bye");
    expect(back.next).toBe("dispatch");
  });
});
