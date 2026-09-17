import { describe, it, expect } from "vitest";
import type { AutomationSpec } from "@bitcrm/types";
import { AUTOMATION_TEMPLATES } from "../templates";
import {
  actionNodeKind,
  chainToSpec,
  isActionNode,
  newChainNode,
  specToChain,
  type ChainNode,
} from "./types";

/** Opened and saved with nothing touched — the one thing this must never change. */
const roundTrip = (spec: AutomationSpec): AutomationSpec => chainToSpec(specToChain(spec), spec);

const kindsOf = (nodes: ChainNode[]): string[] => nodes.map((n) => n.kind);

const base: AutomationSpec = {
  version: 1,
  trigger: { kind: "deal.status_changed", to: ["done"] },
  conditions: [],
  actions: [{ type: "send_sms", to: "client", body: "Hi" }],
};

describe("specToChain", () => {
  it("reads a rule as trigger, conditions, then what it does", () => {
    const nodes = specToChain({
      ...base,
      conditions: [
        { field: "tag", op: "in", values: ["tag-1"], labels: ["VIP"] },
        { any: [{ field: "source", op: "in", values: ["src-gmb"], labels: ["GMB"] }] },
      ],
      actions: [
        { type: "send_sms", to: "client", body: "Hi" },
        { type: "add_tag", tagId: "tag-2" },
        { type: "webhook", url: "https://example.test/hook" },
        { type: "change_sub_status", subStatusId: "sub-1" },
      ],
    });

    expect(kindsOf(nodes)).toEqual([
      "trigger",
      "condition",
      "condition",
      "send",
      "add_tag",
      "webhook",
      "change_sub_status",
    ]);
    // Every payload is a slice of the spec, carried through as it was stored.
    expect(nodes[1].condition).toEqual({ field: "tag", op: "in", values: ["tag-1"], labels: ["VIP"] });
    expect(nodes[3].action).toEqual({ type: "send_sms", to: "client", body: "Hi" });
    expect(nodes.every((n) => n.id)).toBe(true);
    expect(new Set(nodes.map((n) => n.id)).size).toBe(nodes.length);
  });

  it("opens a new rule on a trigger and one message, as the old editor did", () => {
    const nodes = specToChain(undefined);
    expect(kindsOf(nodes)).toEqual(["trigger", "send"]);
    expect(nodes[0].trigger).toEqual({ kind: "deal.status_changed" });
    expect(nodes[1].action).toEqual({ type: "send_sms", to: "client", body: "" });
  });

  it("puts the rule's delay in front of the first thing it does", () => {
    const nodes = specToChain({ ...base, timing: { delayMinutes: 1440, quietHours: "hold" } });
    expect(kindsOf(nodes)).toEqual(["trigger", "wait", "send"]);
    expect(nodes[1].waitMinutes).toBe(1440);
  });

  it("says which kind of card an action is drawn as", () => {
    expect(actionNodeKind("send_email")).toBe("send");
    expect(actionNodeKind("send_in_app")).toBe("send");
    expect(actionNodeKind("webhook")).toBe("webhook");
    expect(isActionNode({ id: "x", kind: "add_tag" })).toBe(true);
    expect(isActionNode({ id: "x", kind: "condition" })).toBe(false);
    expect(isActionNode({ id: "x", kind: "wait" })).toBe(false);
  });
});

/**
 * The whole point of the pair. A rule opened and saved without a deliberate
 * change has to be stored byte for byte as it was found: several of these rules
 * are live, and a quiet widening — a webhook that loses its auth header, a call
 * rule that stops being inbound-only — is the worst thing this change could do.
 */
describe("chainToSpec round-trips", () => {
  it.each(AUTOMATION_TEMPLATES.map((t) => [t.id, t.draft.spec] as const))(
    "leaves the %s recipe exactly as it was",
    (_id, spec) => {
      expect(roundTrip(spec)).toEqual(spec);
    },
  );

  it("keeps an OR group a group, at the index it was stored at", () => {
    const grouped: AutomationSpec = {
      version: 1,
      trigger: { kind: "deal.status_changed", to: ["done"] },
      conditions: [
        { field: "status", op: "in", values: ["done"], labels: ["Done"] },
        {
          any: [
            { field: "source", op: "in", values: ["src-gmb"], labels: ["GMB"] },
            { field: "source", op: "in", values: ["src-yelp"], labels: ["Yelp"] },
            { field: "source", op: "in", values: ["src-fb"], labels: ["Facebook"] },
          ],
        },
        { field: "tag", op: "in", values: ["tag-1"], labels: ["VIP"] },
      ],
      actions: [{ type: "send_sms", to: "client", body: "How did we do?" }],
    };

    expect(kindsOf(specToChain(grouped))).toEqual(["trigger", "condition", "condition", "condition", "send"]);
    expect(roundTrip(grouped)).toEqual(grouped);
  });

  it("keeps a webhook's method, headers and payload", () => {
    const hooked: AutomationSpec = {
      version: 1,
      trigger: { kind: "deal.created" },
      conditions: [],
      actions: [
        { type: "send_sms", to: "client", body: "Booked" },
        {
          type: "webhook",
          url: "https://example.test/hook",
          method: "PUT",
          headers: { "X-Auth": "secret" },
          payload: '{"job":"{{job_id}}"}',
        },
      ],
    };
    expect(roundTrip(hooked)).toEqual(hooked);
  });

  it("keeps the trigger narrowings no card shows", () => {
    const status: AutomationSpec = {
      ...base,
      trigger: {
        kind: "deal.status_changed",
        to: ["done"],
        from: ["in_progress"],
        toSubStatus: ["sub-1"],
        onCreate: false,
      },
    };
    const call: AutomationSpec = {
      ...base,
      trigger: { kind: "call.completed", callOutcome: "missed", callDirection: "inbound" },
    };
    const message: AutomationSpec = {
      ...base,
      trigger: { kind: "message.received", messageChannel: "sms", messagePartyKind: "contact" },
    };

    expect(roundTrip(status)).toEqual(status);
    expect(roundTrip(call)).toEqual(call);
    expect(roundTrip(message)).toEqual(message);
  });

  it("keeps a template with no body of its own", () => {
    const templated: AutomationSpec = {
      ...base,
      actions: [{ type: "send_email", to: "users", userIds: ["u1"], templateId: "tpl-1", subject: "Your job" }],
    };
    expect(roundTrip(templated)).toEqual(templated);
  });

  it("keeps a rule that does several things, in the order it does them", () => {
    const many: AutomationSpec = {
      ...base,
      actions: [
        { type: "send_sms", to: "assigned_techs", body: "On it" },
        { type: "add_tag", tagId: "tag-2" },
        { type: "send_email", to: "role", roleIds: ["r1"], body: "On it", subject: "Job" },
        { type: "change_sub_status", superStatus: "done", subStatusId: "sub-1" },
        { type: "send_sms", to: "number", number: "+14045551234", body: "Office copy" },
      ],
    };
    expect(roundTrip(many)).toEqual(many);
    expect(kindsOf(specToChain(many))).toEqual([
      "trigger",
      "send",
      "add_tag",
      "send",
      "change_sub_status",
      "send",
    ]);
  });

  it('keeps a "text and email" pair as the two actions it is stored as', () => {
    // One choice in the old editor, two nodes here — and the same two actions
    // either way. The save path collapses the pair and expands it again, so
    // this is the one place that could quietly rewrite a live rule.
    const both: AutomationSpec = {
      ...base,
      actions: [
        { type: "send_sms", to: "client", body: "Booked" },
        { type: "send_email", to: "client", body: "Booked", subject: "Your job" },
      ],
    };
    expect(kindsOf(specToChain(both))).toEqual(["trigger", "send", "send"]);
    expect(roundTrip(both)).toEqual(both);
  });

  it("keeps the delivery window and what happens outside it", () => {
    const windowed: AutomationSpec = {
      ...base,
      timing: { quietHours: "skip", workingHours: { from: "08:00", to: "18:00" } },
    };
    expect(roundTrip(windowed)).toEqual(windowed);
  });
});

describe("the wait node", () => {
  const delayed: AutomationSpec = { ...base, timing: { delayMinutes: 60, quietHours: "hold" } };

  it("is the rule's delay, read and written as the same thing", () => {
    expect(roundTrip(delayed)).toEqual(delayed);
  });

  it("drops the delay when the wait is deleted", () => {
    const nodes = specToChain(delayed).filter((n) => n.kind !== "wait");
    expect(chainToSpec(nodes, delayed).timing).toBeUndefined();
  });

  it("adds one where a rule had none", () => {
    const nodes = specToChain(base);
    const wait = { ...newChainNode("wait"), waitMinutes: 15 };
    expect(chainToSpec([nodes[0], wait, nodes[1]], base).timing).toEqual({
      delayMinutes: 15,
      quietHours: "hold",
    });
  });

  it("counts two waits as the time before anything is sent, losing neither", () => {
    // The menu offers one, but a chain that holds two must not throw one away.
    const nodes = [
      ...specToChain(base).slice(0, 1),
      { ...newChainNode("wait"), waitMinutes: 60 },
      { ...newChainNode("wait"), waitMinutes: 30 },
      ...specToChain(base).slice(1),
    ];
    expect(chainToSpec(nodes, base).timing?.delayMinutes).toBe(90);
  });
});

describe("chainToSpec and the fields no node holds", () => {
  const windowed: AutomationSpec = {
    ...base,
    timing: { delayMinutes: 30, quietHours: "skip", workingHours: { from: "08:00", to: "18:00" } },
  };

  it("carries the window and the quiet-hours answer through `previous`", () => {
    const nodes = specToChain(windowed);
    expect(chainToSpec(nodes, windowed).timing).toEqual({
      delayMinutes: 30,
      quietHours: "skip",
      workingHours: { from: "08:00", to: "18:00" },
    });
  });

  it("grows no window on a rule that never had one", () => {
    expect(chainToSpec(specToChain(base), base).timing).toBeUndefined();
    expect(chainToSpec(specToChain(base)).timing).toBeUndefined();
  });

  it("falls back to the stored trigger when the chain has lost its trigger node", () => {
    const withoutTrigger = specToChain(base).filter((n) => n.kind !== "trigger");
    expect(chainToSpec(withoutTrigger, base).trigger).toEqual(base.trigger);
  });

  it("drops a condition that narrows nothing, exactly as saving always has", () => {
    const nodes = [...specToChain(base)];
    nodes.splice(1, 0, newChainNode("condition"));
    expect(chainToSpec(nodes, base).conditions).toEqual([]);
  });
});

describe("newChainNode", () => {
  it("starts each kind on what its panel will fill in", () => {
    expect(newChainNode("send").action).toEqual({ type: "send_sms", to: "client", body: "" });
    expect(newChainNode("condition").condition).toEqual({ field: "tag", op: "in", values: [] });
    expect(newChainNode("webhook").action).toEqual({ type: "webhook" });
    expect(newChainNode("add_tag").action).toEqual({ type: "add_tag" });
    expect(newChainNode("change_sub_status").action).toEqual({ type: "change_sub_status" });
    expect(newChainNode("wait").waitMinutes).toBe(60);
  });

  it("never hands out an id twice", () => {
    const ids = Array.from({ length: 20 }, () => newChainNode("send").id);
    expect(new Set([...ids, ...specToChain(base).map((n) => n.id)]).size).toBe(ids.length + 2);
  });
});
