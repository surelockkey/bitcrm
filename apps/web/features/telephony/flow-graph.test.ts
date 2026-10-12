import { describe, it, expect, vi } from "vitest";
import type { CallFlow, CallFlowNode } from "@bitcrm/types";
import { blankStep, exitsOf, orderedSteps, removeStep } from "./flow-graph";

const nodes = (list: CallFlowNode[]): Record<string, CallFlowNode> =>
  Object.fromEntries(list.map((n) => [n.id, n]));

describe("flow-graph", () => {
  it("reads a branching flow in the order a call meets it", () => {
    const flow: Pick<CallFlow, "nodes" | "entryNodeId"> = {
      entryNodeId: "hours",
      nodes: nodes([
        {
          id: "hours", type: "hours", timezone: "UTC",
          windows: [{ day: 1, open: "08:00", close: "18:00" }],
          openNext: "menu", next: "closed",
        },
        {
          id: "menu", type: "menu", prompt: "Press 1.",
          options: [{ key: "1", label: "Dispatch", next: "ring" }],
          timeoutSeconds: 5, repeats: 1,
        },
        { id: "ring", type: "ring", groupId: "g1" },
        { id: "closed", type: "hangup" },
      ]),
    };

    const steps = orderedSteps(flow);

    expect(steps.map((s) => s.node.id)).toEqual(["hours", "menu", "ring", "closed"]);
    // The branch each step hangs off is what makes the list readable.
    expect(steps.map((s) => s.branch)).toEqual([
      undefined, "Open", "Press 1", "Closed",
    ]);
    expect(steps.map((s) => s.depth)).toEqual([0, 1, 2, 1]);
  });

  it("still lists a step nothing points at, so it can be deleted", () => {
    const flow = {
      entryNodeId: "a",
      nodes: nodes([
        { id: "a", type: "hangup" },
        { id: "orphan", type: "say", text: "stranded" },
      ]),
    };

    const steps = orderedSteps(flow);
    expect(steps.map((s) => s.node.id)).toEqual(["a", "orphan"]);
    expect(steps[1].branch).toBe("Not reachable");
  });

  it("survives a flow that points at itself rather than hanging", () => {
    const flow = {
      entryNodeId: "a",
      nodes: nodes([{ id: "a", type: "say", text: "hi", next: "a" }]),
    };
    expect(orderedSteps(flow).map((s) => s.node.id)).toEqual(["a"]);
  });

  it("heals the chain when a step in the middle is removed", () => {
    const before = nodes([
      { id: "a", type: "say", text: "hi", next: "b" },
      { id: "b", type: "say", text: "middle", next: "c" },
      { id: "c", type: "hangup" },
    ]);

    const after = removeStep(before, "b");

    expect(Object.keys(after)).toEqual(["a", "c"]);
    // a now points straight at c — deleting a step must not break the flow.
    expect(after.a.next).toBe("c");
  });

  it("repoints every branch that referenced the removed step", () => {
    const before = nodes([
      {
        id: "menu", type: "menu", prompt: "Press 1.",
        options: [
          { key: "1", label: "One", next: "gone" },
          { key: "2", label: "Two", next: "end" },
        ],
        timeoutSeconds: 5, repeats: 1, next: "gone",
      },
      { id: "gone", type: "say", text: "bye", next: "end" },
      { id: "end", type: "hangup" },
    ]);

    const after = removeStep(before, "gone");
    const menu = after.menu as Extract<CallFlowNode, { type: "menu" }>;

    expect(menu.options.map((o) => o.next)).toEqual(["end", "end"]);
    expect(menu.next).toBe("end");
  });

  it("drops a menu option whose target disappears entirely", () => {
    const before = nodes([
      {
        id: "menu", type: "menu", prompt: "Press 1.",
        options: [{ key: "1", label: "One", next: "gone" }],
        timeoutSeconds: 5, repeats: 1,
      },
      { id: "gone", type: "hangup" },
    ]);

    const after = removeStep(before, "gone");
    const menu = after.menu as Extract<CallFlowNode, { type: "menu" }>;

    // An option pointing nowhere would be refused by the server anyway.
    expect(menu.options).toEqual([]);
  });

  // 2026-10-12: a dispatcher in Ukraine adding an Hours step must not set the
  // business hours to Kyiv — a new step opens on Connecticut's clock.
  it("opens a new Hours step on Connecticut's clock, whatever the browser's zone", async () => {
    const original = Intl.DateTimeFormat.prototype.resolvedOptions;
    const spy = vi
      .spyOn(Intl.DateTimeFormat.prototype, "resolvedOptions")
      .mockImplementation(function (this: Intl.DateTimeFormat) {
        return { ...original.call(this), timeZone: "Europe/Kyiv" };
      });
    try {
      vi.resetModules();
      const fresh = await import("./flow-graph");
      expect(fresh.blankStep("hours")).toMatchObject({ type: "hours", timezone: "America/New_York" });
    } finally {
      spy.mockRestore();
    }
  });

  it("gives every new step its own id", () => {
    const ids = new Set([blankStep("say").id, blankStep("say").id, blankStep("ring").id]);
    expect(ids.size).toBe(3);
  });

  it("lists both exits of a branching step", () => {
    expect(
      exitsOf({
        id: "h", type: "hours", timezone: "UTC", windows: [],
        openNext: "open", next: "closed",
      }),
    ).toEqual(["closed", "open"]);
  });
});
