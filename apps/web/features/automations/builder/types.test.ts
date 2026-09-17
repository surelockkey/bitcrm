import { describe, it, expect } from "vitest";
import type { AutomationSpec } from "@bitcrm/types";
import { AUTOMATION_TEMPLATES } from "../templates";
import { specToForm, toSpec, type AutomationFormOutput } from "../schemas";
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

/**
 * The same rules through the editor that is being replaced and through the one
 * replacing it, compared field by field. `toEqual` above reads a missing key
 * and a key set to `undefined` as the same thing, and the narrowings at stake
 * here are exactly the keys that go missing — so these are `toStrictEqual`,
 * and they are against the old editor's own output rather than against a
 * hand-written expectation, which is the only baseline that can prove nothing
 * moved.
 */
describe("the chain saves what the form editor saved", () => {
  const throughTheForm = (spec: AutomationSpec): AutomationSpec =>
    toSpec(specToForm("x", spec) as unknown as AutomationFormOutput);

  const handBuilt: Array<[string, AutomationSpec]> = [
    [
      "an OR group between two plain conditions, on a trigger narrowed by `from` and `onCreate`",
      {
        version: 1,
        trigger: { kind: "deal.status_changed", to: ["done"], from: ["in_progress"], onCreate: false },
        conditions: [
          { field: "tag", op: "in", values: ["t1"], labels: ["VIP"] },
          { any: [{ field: "source", op: "in", values: ["a"] }, { field: "source", op: "in", values: ["b"] }] },
          { field: "status", op: "ne", values: ["canceled"] },
        ],
        actions: [{ type: "send_sms", to: "client", body: "hi" }],
      },
    ],
    [
      "a webhook with its method, headers and payload, inside a delivery window",
      {
        version: 1,
        trigger: { kind: "deal.created" },
        conditions: [],
        actions: [
          {
            type: "webhook",
            url: "https://x.test/h",
            method: "PUT",
            headers: { "X-Auth": "s", "Content-Type": "application/json" },
            payload: '{"a":1}',
          },
        ],
        timing: { quietHours: "skip", workingHours: { from: "08:00", to: "18:00" } },
      },
    ],
    [
      "a template with no body of its own, to two named users",
      {
        version: 1,
        trigger: { kind: "message.received", messageChannel: "sms", messagePartyKind: "contact" },
        conditions: [],
        actions: [{ type: "send_email", to: "users", userIds: ["u1", "u2"], templateId: "tpl", subject: "S" }],
      },
    ],
    [
      "an inbound-only missed call texting a bare number",
      {
        version: 1,
        trigger: { kind: "call.completed", callOutcome: "missed", callDirection: "inbound" },
        conditions: [],
        actions: [{ type: "send_sms", to: "number", number: "+14045551234", body: "b" }],
      },
    ],
    [
      "five actions, a delay and a sub-status trigger",
      {
        version: 1,
        trigger: { kind: "deal.status_changed", to: ["done"], toSubStatus: ["s1"] },
        conditions: [],
        actions: [
          { type: "send_sms", to: "assigned_techs", body: "a" },
          { type: "add_tag", tagId: "t2" },
          { type: "send_email", to: "role", roleIds: ["r1"], body: "a", subject: "S" },
          { type: "change_sub_status", superStatus: "done", subStatusId: "s9" },
          { type: "send_sms", to: "client", body: "z" },
        ],
        timing: { delayMinutes: 90, quietHours: "hold" },
      },
    ],
    [
      'a "text and email" pair, which the save path collapses and expands again',
      {
        version: 1,
        trigger: { kind: "deal.created" },
        conditions: [],
        actions: [
          { type: "send_sms", to: "client", body: "B" },
          { type: "send_email", to: "client", body: "B", subject: "Your job" },
        ],
      },
    ],
    [
      "a rule stored with no conditions key at all",
      { version: 1, trigger: { kind: "deal.created" }, actions: [{ type: "send_sms", to: "client", body: "x" }] },
    ],
    [
      "an in-app notice to the dispatcher on any job change",
      {
        version: 1,
        trigger: { kind: "deal.updated" },
        conditions: [{ field: "isLead", op: "exists" }],
        actions: [{ type: "send_in_app", to: "dispatcher", body: "x" }],
      },
    ],
    [
      'a reminder counted after the job ends, sending anyway outside quiet hours',
      {
        version: 1,
        trigger: { kind: "schedule.relative", anchor: "scheduledEnd", offsetMinutes: 2880 },
        conditions: [],
        actions: [{ type: "send_sms", to: "client", body: "x" }],
        timing: { delayMinutes: 5, quietHours: "ignore" },
      },
    ],
  ];

  const cases: Array<[string, AutomationSpec]> = [
    ...AUTOMATION_TEMPLATES.map((t) => [`the ${t.id} recipe`, t.draft.spec] as [string, AutomationSpec]),
    ...handBuilt,
  ];

  it.each(cases)("%s goes through the chain exactly as it went through the form", (_name, spec) => {
    expect(roundTrip(spec)).toStrictEqual(throughTheForm(spec));
  });

  it.each(cases)("%s comes back from the chain as it was stored", (_name, spec) => {
    // `conditions` is optional on the spec and both editors write it, so the
    // one rule stored without it gains an empty list — as it always has.
    expect(roundTrip(spec)).toStrictEqual({ conditions: [], ...spec });
  });

  it("leaves the whitespace a stored rule carries exactly where it is", () => {
    // The dialog this replaced saved `toSpec(schema.parse(values))`, and the
    // schema trims `url` / `number` / `email` / `templateId` — so opening an
    // imported rule and pressing Save rewrote fields nobody had touched. The
    // chain hands `toSpec` the values as they were read instead. Do not
    // "fix" this by parsing on the way out: a rule opened and saved with
    // nothing changed has to be stored as it was found, and normalising it is
    // a change like any other.
    //
    // It leaves one gap, and it is the panel's to close: a URL *typed* with a
    // stray space is stored with it, so the settings panel trims what it
    // writes onto a node.
    const padded: AutomationSpec = {
      version: 1,
      trigger: { kind: "deal.created" },
      conditions: [],
      actions: [{ type: "webhook", url: " https://x.test/h " }],
    };
    expect(roundTrip(padded).actions[0].url).toBe(" https://x.test/h ");
  });

  it("drops a stored condition that matched everything, rather than keeping it", () => {
    // An `in` with no values narrows nothing: the evaluator reads it as "this
    // field is not narrowed", so storing it back would be a rule that fires
    // for every job wearing a condition that says otherwise.
    const wide: AutomationSpec = {
      version: 1,
      trigger: { kind: "deal.created" },
      conditions: [{ field: "tag", op: "in", values: [] }],
      actions: [{ type: "send_sms", to: "client", body: "x" }],
    };
    expect(roundTrip(wide).conditions).toStrictEqual([]);
    expect(roundTrip(wide)).toStrictEqual(throughTheForm(wide));
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
