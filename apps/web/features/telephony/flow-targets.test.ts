import { describe, expect, it } from "vitest";
import type { RingNode } from "@bitcrm/types";
import { blankStep, ringTargetLabel, STEP_LABEL, type TargetNames } from "./flow-graph";

/**
 * A Forward step (Workiz's word for the ring step) names a group, a user, a
 * device or an outside number. The canvas card and the flows list say which
 * in words a dispatcher knows — a name, never an id.
 */
const names: TargetNames = {
  group: (id) => ({ g1: "Dispatch" })[id],
  user: (id) => ({ "u-riley": "Riley CSR" })[id],
  device: (id) => ({ "d-ct": "SURE CT LOCKSMITH" })[id],
};

const ring = (over: Partial<RingNode>): RingNode => ({ id: "r", type: "ring", ...over });

describe("ringTargetLabel", () => {
  it("names a group the old way and the new way alike", () => {
    expect(ringTargetLabel(ring({ groupId: "g1" }), names)).toBe("Dispatch");
    expect(ringTargetLabel(ring({ target: { kind: "group", id: "g1" } }), names)).toBe("Dispatch");
  });

  it("names a user, a device and an outside number", () => {
    expect(ringTargetLabel(ring({ target: { kind: "user", id: "u-riley" } }), names)).toBe("Riley CSR");
    expect(ringTargetLabel(ring({ target: { kind: "device", id: "d-ct" } }), names)).toBe("SURE CT LOCKSMITH");
    expect(ringTargetLabel(ring({ target: { kind: "external", number: "+18888996849" } }), names)).toBe("(888) 899-6849");
  });

  it("says what is gone rather than showing a bare id", () => {
    expect(ringTargetLabel(ring({ groupId: "g-gone" }), names)).toBe("a deleted group");
    expect(ringTargetLabel(ring({ target: { kind: "user", id: "u-gone" } }), names)).toBe("a former teammate");
    expect(ringTargetLabel(ring({ target: { kind: "device", id: "d-gone" } }), names)).toBe("a deleted device");
  });

  it("says a step is unfinished when it names nobody", () => {
    expect(ringTargetLabel(ring({}), names)).toBe("No target picked yet");
    expect(ringTargetLabel(ring({ target: { kind: "group", id: "" } }), names)).toBe("No target picked yet");
    expect(ringTargetLabel(ring({ target: { kind: "external", number: "" } }), names)).toBe("No target picked yet");
  });
});

describe("a new Forward step", () => {
  it("is called Forward, as in Workiz, and opens on the Group tab with nothing picked", () => {
    expect(STEP_LABEL.ring).toBe("Forward");
    const step = blankStep("ring");
    expect(step.type).toBe("ring");
    expect((step as RingNode).target).toEqual({ kind: "group", id: "" });
    expect(step).not.toHaveProperty("groupId");
  });
});
