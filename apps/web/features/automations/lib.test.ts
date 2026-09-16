import { describe, it, expect } from "vitest";
import type { AutomationRule, AutomationRun } from "@bitcrm/types";
import {
  OUTCOME_LABEL,
  canEnable,
  firingCount,
  formatFiredAt,
  outcomeTone,
  ruleSentence,
  runSummary,
  sortRules,
} from "./lib";

const rule = (over: Partial<AutomationRule> = {}): AutomationRule => ({
  id: "r1",
  name: "Rule",
  enabled: false,
  createdAt: "2026-09-15T10:00:00.000Z",
  updatedAt: "2026-09-15T10:00:00.000Z",
  ...over,
});

const withSpec = (over: Partial<AutomationRule> = {}) =>
  rule({
    runnable: true,
    spec: {
      version: 1,
      trigger: { kind: "deal.status_changed", to: ["done"] },
      conditions: [{ field: "tag", op: "in", values: ["tag-1"], labels: ["VIP"] }],
      actions: [{ type: "send_sms", to: "client", body: "Thanks!" }],
    },
    ...over,
  });

describe("ruleSentence", () => {
  it("says what a rule with a spec does, naming ids from the catalogs", () => {
    expect(ruleSentence(withSpec(), { done: "Done", "tag-1": "VIP client" })).toBe(
      "When a job has a status of Done and its job tag is VIP client, send the client a text message immediately",
    );
  });

  it("falls back to the rule's own labels, then to Workiz's sentence, then to nothing", () => {
    expect(ruleSentence(withSpec())).toContain("its job tag is VIP");
    expect(ruleSentence(rule({ ruleSentence: { sentence: "When {p1} {p2}" } }))).toBe("When {p1} {p2}");
    expect(ruleSentence(rule())).toBe("");
  });
});

describe("sortRules", () => {
  it("puts running rules first, then runnable ones, then what cannot run", () => {
    const rules = [
      rule({ id: "broken", name: "Invoice due", runnable: false }),
      withSpec({ id: "off", name: "Off but ready" }),
      withSpec({ id: "on", name: "Running", enabled: true }),
    ];
    expect(sortRules(rules).map((r) => r.id)).toEqual(["on", "off", "broken"]);
  });

  it("breaks ties on how often a rule has fired here", () => {
    const rules = [
      withSpec({ id: "quiet", name: "Quiet", firedCount: 2 }),
      withSpec({ id: "busy", name: "Busy", firedCount: 90 }),
    ];
    expect(sortRules(rules).map((r) => r.id)).toEqual(["busy", "quiet"]);
  });
});

describe("canEnable", () => {
  it("allows a built-in or a runnable rule, and nothing else", () => {
    expect(canEnable(rule({ builtin: true }))).toBe(true);
    expect(canEnable(withSpec())).toBe(true);
    expect(canEnable(withSpec({ runnable: false }))).toBe(false);
    expect(canEnable(rule())).toBe(false);
  });
});

describe("firing counts and outcomes", () => {
  it("reports only what the engine itself did", () => {
    expect(firingCount(rule({ firedCount: 12, workizTriggered: 5411 }))).toBe(12);
    expect(firingCount(rule({ workizTriggered: 5411 }))).toBeUndefined();
  });

  it("labels and tones every outcome", () => {
    expect(OUTCOME_LABEL.sent).toBe("Sent");
    expect(outcomeTone("sent")).toBe("ok");
    expect(outcomeTone("failed")).toBe("bad");
    expect(outcomeTone("partial")).toBe("warn");
    expect(outcomeTone("scheduled")).toBe("warn");
    expect(outcomeTone("duplicate")).toBe("muted");
  });

  it("summarises a firing by what its actions did", () => {
    const run = (actions: AutomationRun["actions"], over: Partial<AutomationRun> = {}): AutomationRun => ({
      id: "run",
      ruleId: "r1",
      firedAt: "2026-09-16T15:04:00.000Z",
      trigger: "deal.status_changed",
      entity: "deal:d1",
      occurrence: "o",
      outcome: "sent",
      actions,
      ...over,
    });
    expect(runSummary(run([{ type: "send_sms", outcome: "sent" }, { type: "send_sms", outcome: "sent" }]))).toBe(
      "2 sent",
    );
    expect(runSummary(run([{ type: "send_sms", outcome: "sent" }, { type: "send_sms", outcome: "skipped" }]))).toBe(
      "1 sent, 1 skipped",
    );
    expect(runSummary(run([], { outcome: "skipped", reason: "inside quiet hours" }))).toBe("inside quiet hours");
    expect(runSummary(run([], { outcome: "skipped" }))).toBe("Skipped");
  });
});

describe("formatFiredAt", () => {
  it("shows a short local date and time, and passes anything unreadable through", () => {
    expect(formatFiredAt("2026-09-16T15:04:00.000Z")).toMatch(/Sep 16/);
    expect(formatFiredAt("not a date")).toBe("not a date");
  });
});
