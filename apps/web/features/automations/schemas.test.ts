import { describe, it, expect } from "vitest";
import type { AutomationSpec } from "@bitcrm/types";
import { automationFormSchema, specToForm, toSpec } from "./schemas";

const spec: AutomationSpec = {
  version: 1,
  trigger: { kind: "deal.status_changed", to: ["done"], toSubStatus: ["sub-1"] },
  conditions: [
    { field: "tag", op: "in", values: ["tag-1"], labels: ["VIP"] },
    { field: "hasTechs", op: "exists" },
  ],
  actions: [{ type: "send_sms", to: "client", body: "Hi {{first_name}}" }],
  timing: { delayMinutes: 1440, quietHours: "hold", workingHours: { from: "08:00", to: "18:00" } },
};

const parse = (values: unknown) => automationFormSchema.parse(values);

describe("automation form schema", () => {
  it("round-trips a spec through the form", () => {
    const values = parse(specToForm("Canceled job", spec));
    expect(toSpec(values, spec)).toEqual(spec);
  });

  it("keeps the imported working-hours window the form does not show", () => {
    const values = parse(specToForm("Canceled job", spec));
    expect(toSpec({ ...values, delayMinutes: 0 }, spec).timing).toEqual({
      quietHours: "hold",
      workingHours: { from: "08:00", to: "18:00" },
    });
    // …and writes no timing at all when there is none to keep.
    expect(toSpec({ ...values, delayMinutes: 0 })?.timing).toBeUndefined();
  });

  it("keeps the narrowings the form does not show — editing a message never widens a rule", () => {
    // A translated call rule: inbound only, with a webhook that carries an
    // auth header, a PUT and a JSON body. Editing the text must change the
    // text and nothing else.
    const narrow: AutomationSpec = {
      version: 1,
      trigger: { kind: "call.completed", callOutcome: "missed", callDirection: "inbound" },
      conditions: [],
      actions: [
        { type: "send_sms", to: "client", body: "Sorry we missed you" },
        {
          type: "webhook",
          url: "https://example.test/hook",
          method: "PUT",
          headers: { "X-Auth": "secret" },
          payload: '{"job":"{{job_id}}"}',
        },
      ],
    };
    const values = parse(specToForm("Missed call", narrow));
    const edited = toSpec(
      { ...values, actions: values.actions.map((a, i) => (i === 0 ? { ...a, body: "Sorry we missed your call" } : a)) },
      narrow,
    );

    expect(edited.trigger).toEqual({ kind: "call.completed", callOutcome: "missed", callDirection: "inbound" });
    expect(edited.actions[0]).toMatchObject({ body: "Sorry we missed your call" });
    expect(edited.actions[1]).toEqual(narrow.actions[1]);
  });

  it("keeps an \"any of\" group the editor cannot show — saving must not widen the rule", () => {
    // `NY Bronx Review request text to client`, as the translator reads it:
    // three sources in one group, plus a tag the editor does show.
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

    // The group has no row in the form…
    const values = parse(specToForm("Bronx review", grouped));
    expect(values.conditions.map((c) => c.field)).toEqual(["status", "tag"]);

    // …and comes back in the same slot, untouched, on save.
    expect(toSpec(values, grouped)).toEqual(grouped);

    // Editing a visible condition leaves the group exactly where it was.
    const edited = toSpec(
      { ...values, conditions: values.conditions.map((c) => (c.field === "tag" ? { ...c, values: ["tag-2"] } : c)) },
      grouped,
    );
    expect(edited.conditions?.[1]).toEqual(grouped.conditions![1]);
    expect(edited.conditions?.[2]).toMatchObject({ field: "tag", values: ["tag-2"] });

    // And removing every visible condition still cannot drop the group.
    expect(toSpec({ ...values, conditions: [] }, grouped).conditions).toEqual([grouped.conditions![1]]);
  });

  it("keeps a status trigger's `from` and `onCreate: false`", () => {
    const narrow: AutomationSpec = {
      version: 1,
      trigger: { kind: "deal.status_changed", to: ["done"], from: ["in_progress"], onCreate: false },
      conditions: [],
      actions: [{ type: "send_sms", to: "client", body: "Done" }],
    };
    expect(toSpec(parse(specToForm("Job done", narrow)), narrow).trigger).toEqual(narrow.trigger);
  });

  it("drops the trigger fields that belong to another trigger", () => {
    const values = parse({
      ...specToForm("Rule", spec),
      trigger: {
        kind: "call.completed",
        to: ["done"],
        toSubStatus: ["sub-1"],
        callOutcome: "missed",
        anchor: "scheduledStart",
        offsetMinutes: 0,
      },
    });
    expect(toSpec(values).trigger).toEqual({ kind: "call.completed", callOutcome: "missed" });
  });

  it("keeps a relative trigger's anchor and offset", () => {
    const values = parse({
      ...specToForm("Rule", spec),
      trigger: {
        kind: "schedule.relative",
        to: [],
        toSubStatus: [],
        callOutcome: "any",
        anchor: "scheduledStart",
        offsetMinutes: -60,
      },
    });
    expect(toSpec(values).trigger).toEqual({
      kind: "schedule.relative",
      anchor: "scheduledStart",
      offsetMinutes: -60,
    });
  });

  it("drops a condition left empty", () => {
    const values = parse({
      ...specToForm("Rule", spec),
      conditions: [
        { field: "tag", op: "in", values: [] },
        { field: "hasTechs", op: "exists", values: [] },
      ],
    });
    expect(toSpec(values).conditions).toEqual([{ field: "hasTechs", op: "exists" }]);
  });

  it("refuses a message with no body and no template", () => {
    const result = automationFormSchema.safeParse({
      ...specToForm("Rule", spec),
      actions: [{ type: "send_sms", to: "client", body: "   " }],
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toMatch(/message or pick a template/i);
  });

  it("refuses a webhook without a usable URL, and a number with nobody to text", () => {
    for (const [action, message] of [
      [{ type: "webhook" }, /needs a URL/i],
      [{ type: "webhook", url: "example.com" }, /http/i],
      [{ type: "send_sms", to: "number", body: "hi" }, /number to text/i],
    ] as const) {
      const result = automationFormSchema.safeParse({ ...specToForm("Rule", spec), actions: [action] });
      expect(result.success).toBe(false);
      expect(result.error?.issues[0]?.message).toMatch(message);
    }
  });

  it("refuses a rule with no name, no action, or an impossible delay", () => {
    const base = specToForm("Rule", spec);
    expect(automationFormSchema.safeParse({ ...base, name: " " }).success).toBe(false);
    expect(automationFormSchema.safeParse({ ...base, actions: [] }).success).toBe(false);
    expect(automationFormSchema.safeParse({ ...base, delayMinutes: 999_999 }).success).toBe(false);
  });

  it("starts a rule with no spec on a sensible default, waiting for its message", () => {
    const values = specToForm("New rule");
    expect(values.trigger.kind).toBe("deal.status_changed");
    expect(values.actions).toEqual([{ type: "send_sms", to: "client", body: "" }]);
    // …and refuses to save until that message is written.
    expect(automationFormSchema.safeParse(values).success).toBe(false);
    expect(automationFormSchema.safeParse({ ...values, actions: [{ type: "send_sms", to: "client", body: "Hi" }] }).success).toBe(true);
  });
});
