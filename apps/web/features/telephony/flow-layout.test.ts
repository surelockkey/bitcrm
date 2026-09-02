import { describe, it, expect } from "vitest";
import type { CallFlowNode, HoursNode, MenuNode, SayNode } from "@bitcrm/types";
import type { FlowStep } from "./flow-tree";
import { ENTRY_ID, layoutFlow } from "./flow-layout";

const say = (id: string): SayNode => ({ id, type: "say", text: "hi" });
const voicemail = (id: string): CallFlowNode => ({
  id,
  type: "voicemail",
  prompt: "Leave a message.",
  maxSeconds: 120,
});
const hours = (id: string): HoursNode => ({
  id,
  type: "hours",
  timezone: "UTC",
  windows: [{ day: 1, open: "08:00", close: "18:00" }],
});
const menu = (id: string, keys: string[]): MenuNode => ({
  id,
  type: "menu",
  prompt: "Press.",
  options: keys.map((key) => ({ key, label: "", next: "" })),
  timeoutSeconds: 5,
  repeats: 1,
});

const branching = (node: CallFlowNode, branches: Record<string, FlowStep[]>): FlowStep => ({
  node,
  branches,
});

const nodeFor = (layout: ReturnType<typeof layoutFlow>, id: string) =>
  layout.nodes.find((n) => n.id === id)!;

/** Every insert point the canvas would draw, as `path/index` for readability. */
const inserts = (layout: ReturnType<typeof layoutFlow>) =>
  layout.links
    .filter((l) => l.plus)
    .map((l) => `${l.plus!.path.join("/") || "root"}@${l.plus!.index}`);

describe("flow-layout", () => {
  it("puts the incoming call above the first step, on the same line", () => {
    const layout = layoutFlow([{ node: say("a") }]);

    const entry = nodeFor(layout, ENTRY_ID);
    const first = nodeFor(layout, "a");
    expect(entry.kind).toBe("entry");
    expect(entry.x).toBe(first.x);
    expect(entry.y).toBeLessThan(first.y);
  });

  it("stacks a straight sequence in one column, in call order", () => {
    const layout = layoutFlow([{ node: say("a") }, { node: say("b") }, { node: voicemail("c") }]);

    const [a, b, c] = ["a", "b", "c"].map((id) => nodeFor(layout, id));
    expect(a.x).toBe(b.x);
    expect(b.x).toBe(c.x);
    expect(a.y).toBeLessThan(b.y);
    expect(b.y).toBeLessThan(c.y);
  });

  /**
   * The `+` on every connector is how a step gets added, so there has to be
   * one before the first step and after the last as well as between them —
   * otherwise a flow can only ever grow in the middle.
   */
  it("hangs an insert point on every connector, including both ends", () => {
    const layout = layoutFlow([{ node: say("a") }, { node: say("b") }]);

    expect(inserts(layout)).toEqual(["root@0", "root@1", "root@2"]);
  });

  it("splits a branching step into one column per exit, left to right", () => {
    const layout = layoutFlow([
      branching(hours("h"), { open: [{ node: say("o") }], closed: [{ node: say("c") }] }),
    ]);

    const split = nodeFor(layout, "h");
    const open = nodeFor(layout, "o");
    const closed = nodeFor(layout, "c");
    expect(open.x).toBeLessThan(split.x);
    expect(split.x).toBeLessThan(closed.x);
    expect(open.y).toBe(closed.y);
    expect(open.y).toBeGreaterThan(split.y);
  });

  it("names each branch on the line that leads into it", () => {
    const layout = layoutFlow([
      branching(hours("h"), { open: [{ node: say("o") }], closed: [] }),
    ]);

    const labels = layout.links.map((l) => l.label).filter(Boolean);
    expect(labels).toEqual(["While open", "While closed"]);
  });

  it("still offers an insert point down a branch with nothing in it yet", () => {
    const layout = layoutFlow([
      branching(hours("h"), { open: [], closed: [] }),
    ]);

    expect(inserts(layout)).toContain("h/open@0");
    expect(inserts(layout)).toContain("h/closed@0");
  });

  it("gives a menu a column per key plus one for pressing nothing", () => {
    const layout = layoutFlow([
      branching(menu("m", ["1", "2"]), { "1": [], "2": [], timeout: [] }),
    ]);

    const xs = layout.links
      .filter((l) => l.label)
      .map((l) => l.points[l.points.length - 1].x);
    expect(xs).toHaveLength(3);
    // Three distinct columns, laid out left to right in key order.
    expect([...xs].sort((a, b) => a - b)).toEqual(xs);
  });

  /**
   * A wide branch must not be drawn on top of its sibling: the columns either
   * side of it have to move out of the way.
   */
  it("widens the split so a nested branch doesn't overlap its sibling", () => {
    const layout = layoutFlow([
      branching(hours("h"), {
        open: [branching(menu("m", ["1", "2", "3"]), { "1": [], "2": [], "3": [], timeout: [] })],
        closed: [{ node: say("c") }],
      }),
    ]);

    const keys = layout.links
      .filter((l) => l.label?.startsWith("Press") || l.label === "Presses nothing")
      .map((l) => l.points[l.points.length - 1].x);
    const closed = nodeFor(layout, "c");
    // Every one of the menu's columns sits clear of the closed branch.
    expect(Math.max(...keys)).toBeLessThan(closed.x);
  });

  it("measures a canvas big enough for everything on it", () => {
    const layout = layoutFlow([
      branching(hours("h"), { open: [{ node: say("o") }], closed: [{ node: say("c") }] }),
    ]);

    for (const node of layout.nodes) {
      expect(node.x).toBeGreaterThan(0);
      expect(node.x).toBeLessThan(layout.width);
      expect(node.y).toBeLessThan(layout.height);
    }
  });

  it("draws nothing but the incoming call for a flow with no steps", () => {
    const layout = layoutFlow([]);

    expect(layout.nodes.map((n) => n.id)).toEqual([ENTRY_ID]);
    expect(inserts(layout)).toEqual(["root@0"]);
  });

  /**
   * A branching step has to stay last in its sequence — `toGraph` gives it no
   * main line, so anything below it would stop happening. Moving is offered
   * only where it cannot do that.
   */
  describe("what can move", () => {
    it("lets a step swap with a plain neighbour", () => {
      const layout = layoutFlow([{ node: say("a") }, { node: say("b") }]);

      expect(nodeFor(layout, "a")).toMatchObject({ canMoveEarlier: false, canMoveLater: true });
      expect(nodeFor(layout, "b")).toMatchObject({ canMoveEarlier: true, canMoveLater: false });
    });

    it("won't push a plain step past the split that ends its sequence", () => {
      const layout = layoutFlow([
        { node: say("a") },
        branching(hours("h"), { open: [], closed: [] }),
      ]);

      expect(nodeFor(layout, "a").canMoveLater).toBe(false);
    });

    it("won't move the split itself", () => {
      const layout = layoutFlow([
        { node: say("a") },
        branching(hours("h"), { open: [], closed: [] }),
      ]);

      expect(nodeFor(layout, "h")).toMatchObject({
        canMoveEarlier: false,
        canMoveLater: false,
      });
    });
  });

  it("tells each step where it sits, so the panel can move and delete it", () => {
    const layout = layoutFlow([
      branching(hours("h"), { open: [{ node: say("o") }, { node: say("p") }], closed: [] }),
    ]);

    const p = nodeFor(layout, "p");
    expect(p.path).toEqual(["h", "open"]);
    expect(p.index).toBe(1);
    expect(p.siblings).toBe(2);
  });
});
