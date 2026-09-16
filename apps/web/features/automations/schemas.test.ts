import { describe, it, expect } from "vitest";
import type { AutomationSpec } from "@bitcrm/types";
import {
  automationFormSchema,
  isConditionGroupValues,
  specToForm,
  toSpec,
  type ConditionValues,
} from "./schemas";

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

/** The plain rows of a parsed form, in order — groups skipped. */
const rowsOf = (conditions: ReturnType<typeof parse>["conditions"]): ConditionValues[] =>
  conditions.filter((c): c is ConditionValues => !isConditionGroupValues(c));

describe("automation form schema", () => {
  it("round-trips a spec through the form", () => {
    const values = parse(specToForm("Canceled job", spec));
    expect(toSpec(values)).toEqual(spec);
  });

  it("keeps a delivery window, and never grows one on a rule that had none", () => {
    const values = parse(specToForm("Canceled job", spec));
    expect(values.deliveryWindow).toBe("between");
    expect(values.workingHours).toEqual({ from: "08:00", to: "18:00" });
    expect(toSpec({ ...values, delayMinutes: 0 }).timing).toEqual({
      quietHours: "hold",
      workingHours: { from: "08:00", to: "18:00" },
    });

    // 24/7 drops the window…
    expect(toSpec({ ...values, delayMinutes: 0, deliveryWindow: "always" }).timing).toBeUndefined();
    // …and a rule that never had one opens on 24/7 and stays there, rather
    // than picking up the editor's default hours on its first save.
    const plain = parse(specToForm("Plain", { ...spec, timing: undefined }));
    expect(plain.deliveryWindow).toBe("always");
    expect(toSpec(plain).timing).toBeUndefined();
  });

  it("refuses a window that cannot mean anything", () => {
    const base = specToForm("Rule", spec);
    const between = (from: string, to: string) =>
      automationFormSchema.safeParse({ ...base, deliveryWindow: "between", workingHours: { from, to } });
    expect(between("09:00", "17:00").success).toBe(true);
    expect(between("9am", "17:00").error?.issues[0]?.message).toMatch(/time like 09:00/i);
    expect(between("09:00", "09:00").error?.issues[0]?.message).toMatch(/same as 24\/7/i);
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
    const edited = toSpec({
      ...values,
      actions: values.actions.map((a, i) => (i === 0 ? { ...a, body: "Sorry we missed your call" } : a)),
    });

    expect(edited.trigger).toEqual({ kind: "call.completed", callOutcome: "missed", callDirection: "inbound" });
    expect(edited.actions[0]).toMatchObject({ body: "Sorry we missed your call" });
    expect(edited.actions[1]).toEqual(narrow.actions[1]);
  });

  describe('"any of" groups', () => {
    // `NY Bronx Review request text to client`, as the translator reads it:
    // three sources in one group, plus a tag the editor shows as its own row.
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

    it("gives the group a row of its own, and saves it back unchanged", () => {
      const values = parse(specToForm("Bronx review", grouped));
      expect(values.conditions.map((c) => (isConditionGroupValues(c) ? "group" : c.field))).toEqual([
        "status",
        "group",
        "tag",
      ]);
      expect(toSpec(values)).toEqual(grouped);
    });

    it("edits one alternative without touching the others", () => {
      const values = parse(specToForm("Bronx review", grouped));
      const edited = toSpec({
        ...values,
        conditions: values.conditions.map((node) =>
          isConditionGroupValues(node)
            ? { any: node.any.map((c, i) => (i === 1 ? { ...c, values: ["src-bing"], labels: ["Bing"] } : c)) }
            : node,
        ),
      });
      expect(edited.conditions?.[1]).toEqual({
        any: [
          { field: "source", op: "in", values: ["src-gmb"], labels: ["GMB"] },
          { field: "source", op: "in", values: ["src-bing"], labels: ["Bing"] },
          { field: "source", op: "in", values: ["src-fb"], labels: ["Facebook"] },
        ],
      });
      expect(edited.conditions?.[2]).toEqual(grouped.conditions![2]);
    });

    it("drops an alternative nobody filled in, and the group once none is left", () => {
      const values = parse(specToForm("Bronx review", grouped));
      const withEmpty = toSpec({
        ...values,
        conditions: values.conditions.map((node) =>
          isConditionGroupValues(node)
            ? { any: [...node.any, { field: "source" as const, op: "in" as const, values: [] }] }
            : node,
        ),
      });
      expect(withEmpty.conditions?.[1]).toEqual(grouped.conditions![1]);

      // An `{any: []}` holds for nothing, so an emptied group must not survive
      // as a condition the rule can never satisfy.
      const emptied = toSpec({
        ...values,
        conditions: values.conditions.map((node) => (isConditionGroupValues(node) ? { any: [] } : node)),
      });
      expect(emptied.conditions).toEqual([grouped.conditions![0], grouped.conditions![2]]);
    });

    it("stores a group built in the editor beside the plain rows", () => {
      const values = parse({
        ...specToForm("New", spec),
        conditions: [
          { field: "tag", op: "in", values: ["tag-1"], labels: ["VIP"] },
          {
            any: [
              { field: "source", op: "eq", values: ["src-gmb"], labels: ["GMB"] },
              { field: "jobType", op: "in", values: ["t-1", "t-2"], labels: ["Lockout", "Rekey"] },
            ],
          },
        ],
      });
      expect(toSpec(values).conditions).toEqual([
        { field: "tag", op: "in", values: ["tag-1"], labels: ["VIP"] },
        {
          any: [
            { field: "source", op: "eq", values: ["src-gmb"], labels: ["GMB"] },
            { field: "jobType", op: "in", values: ["t-1", "t-2"], labels: ["Lockout", "Rekey"] },
          ],
        },
      ]);
    });
  });

  it("keeps several values in one condition — one rule where there were 24", () => {
    const values = parse({
      ...specToForm("Review request", spec),
      conditions: [
        {
          field: "source",
          op: "in",
          values: ["src-gmb", "src-yelp", "src-fb"],
          labels: ["GMB", "Yelp", "Facebook"],
        },
      ],
    });
    expect(rowsOf(values.conditions)[0].values).toHaveLength(3);
    expect(toSpec(values).conditions).toEqual([
      { field: "source", op: "in", values: ["src-gmb", "src-yelp", "src-fb"], labels: ["GMB", "Yelp", "Facebook"] },
    ]);
  });

  it("keeps a status trigger's `from` and `onCreate: false`", () => {
    const narrow: AutomationSpec = {
      version: 1,
      trigger: { kind: "deal.status_changed", to: ["done"], from: ["in_progress"], onCreate: false },
      conditions: [],
      actions: [{ type: "send_sms", to: "client", body: "Done" }],
    };
    expect(toSpec(parse(specToForm("Job done", narrow))).trigger).toEqual(narrow.trigger);
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
      },
    });
    expect(toSpec(values).trigger).toEqual({ kind: "call.completed", callOutcome: "missed" });
  });

  describe("the relative trigger's anchor and offset", () => {
    const relative = (over: Record<string, unknown>) =>
      automationFormSchema.safeParse({
        ...specToForm("Rule", spec),
        trigger: {
          kind: "schedule.relative",
          to: [],
          toSubStatus: [],
          callOutcome: "any",
          anchor: "scheduledStart",
          offsetValue: 1,
          offsetUnit: "hours",
          offsetDirection: "before",
          ...over,
        },
      });

    it("reads a stored offset back in the largest whole unit it fits", () => {
      const values = specToForm("Rule", {
        ...spec,
        trigger: { kind: "schedule.relative", anchor: "scheduledStart", offsetMinutes: -60 },
      });
      expect(values.trigger).toMatchObject({ offsetValue: 1, offsetUnit: "hours", offsetDirection: "before" });
      expect(toSpec(parse(values)).trigger).toEqual({
        kind: "schedule.relative",
        anchor: "scheduledStart",
        offsetMinutes: -60,
      });
    });

    it("folds the three fields back into the minutes the engine reads", () => {
      const of = (over: Record<string, unknown>) => {
        const result = relative(over);
        if (!result.success) throw result.error;
        return toSpec(result.data).trigger.offsetMinutes;
      };
      expect(of({})).toBe(-60);
      expect(of({ offsetDirection: "after", offsetValue: 3, offsetUnit: "days" })).toBe(4320);
      expect(of({ offsetDirection: "after", offsetValue: 0, offsetUnit: "minutes" })).toBe(0);
      expect(of({ offsetDirection: "after", offsetValue: 10, offsetUnit: "minutes", anchor: "createdAt" })).toBe(10);
    });

    it("refuses a reminder ahead of a date that has already passed", () => {
      // The scheduler arms nothing for a moment gone by, so "1 hour ahead of
      // when it was created" is a rule that can never fire.
      for (const anchor of ["createdAt", "statusChangedAt"]) {
        expect(relative({ anchor }).error?.issues[0]?.message).toMatch(/never fires/i);
        expect(relative({ anchor, offsetDirection: "after" }).success).toBe(true);
      }
      expect(relative({ anchor: "scheduledEnd" }).success).toBe(true);
    });

    it("refuses an offset further out than the spec can hold", () => {
      expect(relative({ offsetValue: 31, offsetUnit: "days" }).error?.issues[0]?.message).toMatch(/30 days/i);
      expect(relative({ offsetValue: 30, offsetUnit: "days" }).success).toBe(true);
    });
  });

  describe('"send text and email"', () => {
    const both: AutomationSpec = {
      version: 1,
      trigger: { kind: "deal.status_changed", to: ["done"] },
      conditions: [],
      actions: [
        { type: "send_sms", to: "client", body: "Your job is done" },
        { type: "send_email", to: "client", body: "Your job is done", subject: "All done" },
      ],
    };

    it("reads the pair back as one row and writes it out as two", () => {
      const values = parse(specToForm("Job done", both));
      expect(values.actions).toHaveLength(1);
      expect(values.actions[0]).toMatchObject({ type: "send_sms_email", subject: "All done" });
      expect(toSpec(values).actions).toEqual(both.actions);
    });

    it("splits a number and an address between the two halves", () => {
      const values = parse({
        ...specToForm("Office", both),
        actions: [
          {
            type: "send_sms_email",
            to: "number",
            body: "Heads up",
            subject: "Heads up",
            number: "+14045551234",
            email: "office@example.test",
          },
        ],
      });
      expect(toSpec(values).actions).toEqual([
        { type: "send_sms", to: "number", number: "+14045551234", body: "Heads up" },
        { type: "send_email", to: "number", email: "office@example.test", body: "Heads up", subject: "Heads up" },
      ]);
    });

    it("leaves two actions that only look alike as two actions", () => {
      const different: AutomationSpec = {
        ...both,
        actions: [
          { type: "send_sms", to: "client", body: "Your job is done" },
          { type: "send_email", to: "assigned_techs", body: "Your job is done" },
        ],
      };
      const values = parse(specToForm("Job done", different));
      expect(values.actions.map((a) => a.type)).toEqual(["send_sms", "send_email"]);
      expect(toSpec(values).actions).toEqual(different.actions);
    });

    it("asks for both addresses when it is sending to a raw number", () => {
      const of = (over: Record<string, unknown>) =>
        automationFormSchema.safeParse({
          ...specToForm("Office", both),
          actions: [{ type: "send_sms_email", to: "number", body: "Hi", ...over }],
        });
      expect(of({ email: "office@example.test" }).error?.issues[0]?.message).toMatch(/number to text/i);
      expect(of({ number: "+14045551234" }).error?.issues[0]?.message).toMatch(/address to email/i);
      expect(of({ number: "+14045551234", email: "office@example.test" }).success).toBe(true);
    });
  });

  it("refuses a recipient nobody named — the rule that used to send to nobody", () => {
    const of = (action: Record<string, unknown>) =>
      automationFormSchema.safeParse({ ...specToForm("Rule", spec), actions: [{ body: "Hi", ...action }] });
    expect(of({ type: "send_sms", to: "users" }).error?.issues[0]?.message).toMatch(/at least one person/i);
    expect(of({ type: "send_sms", to: "users", userIds: ["u1"] }).success).toBe(true);
    expect(of({ type: "send_sms", to: "role" }).error?.issues[0]?.message).toMatch(/at least one role/i);
    expect(of({ type: "send_sms", to: "role", roleIds: ["r1"] }).success).toBe(true);
  });

  it("stores the people and roles a message action names", () => {
    const values = parse({
      ...specToForm("Rule", spec),
      actions: [{ type: "send_sms", to: "users", body: "Cover the phones", userIds: ["u1", "u2"] }],
    });
    expect(toSpec(values).actions).toEqual([
      { type: "send_sms", to: "users", body: "Cover the phones", userIds: ["u1", "u2"] },
    ]);
  });

  it("keeps an email subject, and drops it from a channel that has none", () => {
    const withSubject = parse({
      ...specToForm("Rule", spec),
      actions: [{ type: "send_email", to: "client", body: "Hi", subject: "Your appointment" }],
    });
    expect(toSpec(withSubject).actions[0]).toEqual({
      type: "send_email",
      to: "client",
      body: "Hi",
      subject: "Your appointment",
    });
    const blank = parse({
      ...specToForm("Rule", spec),
      actions: [{ type: "send_email", to: "client", body: "Hi", subject: "  " }],
    });
    expect(toSpec(blank).actions[0]).toEqual({ type: "send_email", to: "client", body: "Hi" });
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
    expect(values.deliveryWindow).toBe("always");
    // …and refuses to save until that message is written.
    expect(automationFormSchema.safeParse(values).success).toBe(false);
    expect(automationFormSchema.safeParse({ ...values, actions: [{ type: "send_sms", to: "client", body: "Hi" }] }).success).toBe(true);
  });
});
