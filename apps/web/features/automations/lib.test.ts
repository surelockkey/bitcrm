import { describe, it, expect } from "vitest";
import type { AutomationRule, AutomationRun } from "@bitcrm/types";
import {
  OUTCOME_LABEL,
  anchorAllowsBefore,
  canEnable,
  categoryLabel,
  filterRules,
  firingCount,
  formatEditedAt,
  formatFiredAt,
  isFiltered,
  joinOffset,
  messageSegments,
  outcomeTone,
  ruleCategories,
  ruleCategory,
  ruleSentence,
  ruleState,
  runSummary,
  segmentsToBody,
  sortRules,
  splitOffset,
  triggerHasJob,
} from "./lib";
import { AUTOMATION_TEMPLATES } from "./templates";

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

  it("says one channel choice per clause — a shared text and email is one thing", () => {
    // Workiz's `notify_medium: both` is one entry in the editor and two
    // actions in the spec; saying it twice would read as two decisions.
    const both = withSpec({
      spec: {
        version: 1,
        trigger: { kind: "deal.status_changed", to: ["done"] },
        conditions: [],
        actions: [
          { type: "send_sms", to: "client", body: "All done" },
          { type: "send_email", to: "client", body: "All done", subject: "All done" },
        ],
      },
    });
    expect(ruleSentence(both, { done: "Done" })).toBe(
      "When a job has a status of Done, send the client a text and email immediately",
    );

    // Two messages that are not the same message stay two clauses.
    const apart = withSpec({
      spec: {
        version: 1,
        trigger: { kind: "deal.created" },
        conditions: [],
        actions: [
          { type: "send_sms", to: "client", body: "Booked" },
          { type: "send_email", to: "assigned_techs", body: "New job" },
        ],
      },
    });
    expect(ruleSentence(apart)).toBe(
      "When a job is created, send the client a text message, and send the assigned tech an email immediately",
    );
  });

  it("names the people and roles an action notifies, when it knows what they are called", () => {
    const toUsers = (over: Record<string, unknown>) =>
      withSpec({
        spec: {
          version: 1,
          trigger: { kind: "call.completed", callOutcome: "missed" },
          conditions: [],
          actions: [{ type: "send_sms", body: "Missed one", ...over }],
        },
      });

    expect(ruleSentence(toUsers({ to: "users", userIds: ["u1", "u2"] }), { u1: "Ann Lee", u2: "Bo Diaz" })).toBe(
      "When a call is missed, send Ann Lee or Bo Diaz a text message immediately",
    );
    expect(ruleSentence(toUsers({ to: "role", roleIds: ["r1"] }), { r1: "Dispatch" })).toBe(
      "When a call is missed, send Dispatch a text message immediately",
    );
    // A sentence full of uuids is worse than the generic phrase, so an id the
    // caller cannot name keeps the rule reading as Workiz wrote it.
    expect(ruleSentence(toUsers({ to: "users", userIds: ["u1", "u2"] }), { u1: "Ann Lee" })).toContain(
      "send selected users a text message",
    );
    expect(ruleSentence(toUsers({ to: "users" }))).toContain("send selected users a text message");
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

describe("formatEditedAt", () => {
  it("shows a short date with the year, and passes anything unreadable through", () => {
    expect(formatEditedAt("2024-10-09T12:00:00.000Z")).toMatch(/Oct 9, 2024/);
    expect(formatEditedAt("not a date")).toBe("not a date");
  });
});

describe("ruleState", () => {
  it("splits the list into on, off and what cannot run", () => {
    expect(ruleState(withSpec({ enabled: true }))).toBe("on");
    expect(ruleState(withSpec())).toBe("off");
    expect(ruleState(rule({ runnable: false }))).toBe("blocked");
    // A built-in that is off is still switchable, so it is "off", not blocked.
    expect(ruleState(rule({ builtin: true }))).toBe("off");
  });
});

describe("categories", () => {
  it("reads a missing category as custom", () => {
    expect(ruleCategory(rule())).toBe("custom");
    expect(ruleCategory(rule({ category: "phone" }))).toBe("phone");
  });

  it("names the Workiz library sections, and turns anything else into words", () => {
    expect(categoryLabel("followUps")).toBe("Follow-ups");
    expect(categoryLabel("custom")).toBe("Custom");
    expect(categoryLabel("job-status")).toBe("Job status");
  });

  it("lists only the categories the workspace actually uses, by label", () => {
    expect(
      ruleCategories([rule({ category: "phone" }), rule(), rule({ category: "marketing" }), rule()]),
    ).toEqual(["custom", "marketing", "phone"]);
  });
});

describe("filterRules", () => {
  const list = [
    withSpec({ id: "on", name: "Canceled job & techs", enabled: true, firedCount: 90, category: "job" }),
    withSpec({
      id: "off",
      name: "Review request",
      firedCount: 2,
      updatedAt: "2026-09-16T00:00:00.000Z",
      spec: {
        version: 1,
        trigger: { kind: "call.completed", callOutcome: "missed" },
        conditions: [],
        actions: [{ type: "send_sms", to: "client", body: "Sorry we missed you" }],
      },
    }),
    rule({ id: "blocked", name: "Invoice due 7 days", runnable: false, category: "followUps" }),
  ];

  it("keeps everything, most used first, with no filter", () => {
    expect(filterRules(list, {}).map((r) => r.id)).toEqual(["on", "off", "blocked"]);
  });

  it("matches the name and the sentence, every word of the search", () => {
    expect(filterRules(list, { search: "invoice" }).map((r) => r.id)).toEqual(["blocked"]);
    // "canceled" is only in the rendered sentence, not in the name.
    expect(filterRules(list, { search: "status of canceled" }).map((r) => r.id)).toEqual(["on"]);
    expect(filterRules(list, { search: "canceled review" })).toEqual([]);
  });

  it("filters by state, and treats several chips as a union", () => {
    expect(filterRules(list, { states: ["on"] }).map((r) => r.id)).toEqual(["on"]);
    expect(filterRules(list, { states: ["off", "blocked"] }).map((r) => r.id)).toEqual([
      "off",
      "blocked",
    ]);
  });

  it("filters by trigger, which a rule without a spec never matches", () => {
    expect(filterRules(list, { trigger: "call.completed" }).map((r) => r.id)).toEqual(["off"]);
    expect(filterRules(list, { trigger: "deal.created" })).toEqual([]);
  });

  it("filters by category, with custom covering the rules that carry none", () => {
    expect(filterRules(list, { category: "followUps" }).map((r) => r.id)).toEqual(["blocked"]);
    expect(filterRules(list, { category: "custom" }).map((r) => r.id)).toEqual(["off"]);
  });

  it("sorts by name and by when the rule was last edited", () => {
    expect(filterRules(list, { sort: "name" }).map((r) => r.id)).toEqual(["on", "blocked", "off"]);
    expect(filterRules(list, { sort: "edited" }).map((r) => r.id)).toEqual(["off", "on", "blocked"]);
  });

  it("does not disturb the list it was given", () => {
    const input = [...list];
    filterRules(input, { sort: "name" });
    expect(input.map((r) => r.id)).toEqual(["on", "off", "blocked"]);
  });
});

describe("triggerHasJob", () => {
  it("is true for everything but a call and an inbound message", () => {
    for (const kind of ["deal.created", "deal.status_changed", "deal.updated", "schedule.relative"] as const) {
      expect(triggerHasJob(kind)).toBe(true);
    }
    // The engine hands a call and a message no deal, so a recipient read off
    // the job — the dispatcher, the assigned techs — resolves to nobody.
    expect(triggerHasJob("call.completed")).toBe(false);
    expect(triggerHasJob("message.received")).toBe(false);
  });
});

describe("the relative trigger's offset", () => {
  it("reads back in the largest whole unit, and folds back to the same minutes", () => {
    expect(splitOffset(-60)).toEqual({ value: 1, unit: "hours", direction: "before" });
    expect(splitOffset(4320)).toEqual({ value: 3, unit: "days", direction: "after" });
    expect(splitOffset(90)).toEqual({ value: 90, unit: "minutes", direction: "after" });
    expect(splitOffset(0)).toEqual({ value: 0, unit: "minutes", direction: "after" });
    expect(splitOffset(undefined)).toEqual({ value: 0, unit: "minutes", direction: "after" });

    for (const minutes of [0, 1, -1, 59, -60, 600, -1440, 4320, -43200, 43200, 137, -2879]) {
      expect(joinOffset(splitOffset(minutes))).toBe(minutes);
    }
  });

  it("allows an offset ahead only of a date still to come", () => {
    expect(anchorAllowsBefore("scheduledStart")).toBe(true);
    expect(anchorAllowsBefore("scheduledEnd")).toBe(true);
    // Both have already happened by the time any event reaches the engine, and
    // the scheduler arms nothing for a moment gone by.
    expect(anchorAllowsBefore("createdAt")).toBe(false);
    expect(anchorAllowsBefore("statusChangedAt")).toBe(false);
  });
});

describe("messageSegments", () => {
  it("splits a body into text and atomic short codes", () => {
    expect(messageSegments("Hi {{first_name}}, job {{job_id}}.")).toEqual([
      { type: "text", text: "Hi " },
      { type: "code", code: "first_name", raw: "{{first_name}}" },
      { type: "text", text: ", job " },
      { type: "code", code: "job_id", raw: "{{job_id}}" },
      { type: "text", text: "." },
    ]);
    expect(messageSegments("")).toEqual([]);
    expect(messageSegments("No codes here")).toEqual([{ type: "text", text: "No codes here" }]);
  });

  it("keeps a placeholder exactly as it was written", () => {
    // The renderer takes spaces and custom-field names too (`PLACEHOLDER`), so
    // an editor that tidied them would be editing a message nobody touched.
    const odd = "{{ job_date }} and {{Gate code}}";
    expect(messageSegments(odd).map((s) => (s.type === "code" ? s.code : s.text))).toEqual([
      "job_date",
      " and ",
      "Gate code",
    ]);
    expect(segmentsToBody(messageSegments(odd))).toBe(odd);
  });

  it("round-trips every body the recipe library ships, character for character", () => {
    const bodies = AUTOMATION_TEMPLATES.flatMap((t) => t.draft.spec.actions.map((a) => a.body ?? ""));
    expect(bodies.length).toBeGreaterThan(0);
    for (const body of bodies) expect(segmentsToBody(messageSegments(body))).toBe(body);
  });

  it("round-trips the shapes the imported rules put in a body", () => {
    for (const body of [
      "",
      "{{job_id}}",
      "{{job_id}}{{job_date}}",
      "Line one\nLine two {{full_address}}\n\nLine four",
      "Braces { alone } and {{tech_assigned}}",
      "50% off — {{biz_name}} ({{biz_number}})",
      "{{unclosed",
      "}}stray{{",
    ]) {
      expect(segmentsToBody(messageSegments(body))).toBe(body);
    }
  });
});

describe("isFiltered", () => {
  it("is true only when something narrows the list — the sort never does", () => {
    expect(isFiltered({})).toBe(false);
    expect(isFiltered({ sort: "name" })).toBe(false);
    expect(isFiltered({ search: "  " })).toBe(false);
    expect(isFiltered({ search: "invoice" })).toBe(true);
    expect(isFiltered({ states: ["on"] })).toBe(true);
    expect(isFiltered({ trigger: "deal.created" })).toBe(true);
    expect(isFiltered({ category: "phone" })).toBe(true);
  });
});
