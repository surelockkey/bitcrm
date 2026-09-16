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
