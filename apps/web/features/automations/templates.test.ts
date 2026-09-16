import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";
import { JobSuperStatus } from "@bitcrm/types";
import { automationFormSchema, specToForm, toSpec } from "./schemas";
import { AUTOMATION_TEMPLATES, AUTOMATION_TEMPLATE_SECTIONS } from "./templates";

/**
 * The short codes the renderer can actually fill, read from the one list that
 * defines them (`SHORT_CODES`, messaging-service). A recipe that ships a code
 * nothing resolves sends the client a message with a hole in it, and the hole
 * is invisible until it has been sent.
 */
const SHORT_CODES_FILE = "backend/services/messaging/src/templates/short-codes.ts";

function shortCodesSource(): string {
  for (let dir = process.cwd(); ; dir = path.dirname(dir)) {
    const candidate = path.join(dir, SHORT_CODES_FILE);
    if (existsSync(candidate)) return readFileSync(candidate, "utf8");
    if (path.dirname(dir) === dir) throw new Error(`${SHORT_CODES_FILE} not found above ${process.cwd()}`);
  }
}

const KNOWN_SHORT_CODES = [...shortCodesSource().matchAll(/^\s*def\('([a-z0-9_]+)'/gm)].map((m) => m[1]);

const bodiesOf = (spec: (typeof AUTOMATION_TEMPLATES)[number]["draft"]["spec"]) =>
  spec.actions.map((a) => a.body ?? "").join("\n");

const codesIn = (text: string) => [...text.matchAll(/\{\{\s*([^{}]+?)\s*\}\}/g)].map((m) => m[1]);

/** Every value a spec pins to something the workspace owns. */
const idsIn = (spec: (typeof AUTOMATION_TEMPLATES)[number]["draft"]["spec"]) => [
  ...(spec.trigger.toSubStatus ?? []),
  ...spec.conditions.flatMap((c) => c.values ?? []),
  ...spec.actions.flatMap((a) => [
    ...(a.userIds ?? []),
    ...(a.roleIds ?? []),
    ...(a.tagId ? [a.tagId] : []),
    ...(a.subStatusId ? [a.subStatusId] : []),
    ...(a.templateId ? [a.templateId] : []),
  ]),
];

describe("automation template catalog", () => {
  it("read the short-code list it validates against, and the codes the bodies use", () => {
    expect(KNOWN_SHORT_CODES).toContain("first_name");
    expect(KNOWN_SHORT_CODES.length).toBeGreaterThan(20);
    // …so the per-recipe check below is not quietly passing on nothing.
    const used = new Set(AUTOMATION_TEMPLATES.flatMap((t) => codesIn(bodiesOf(t.draft.spec))));
    expect(used.size).toBeGreaterThan(5);
    expect(codesIn("Job {{job_id}} for {{not_a_code}}")).toEqual(["job_id", "not_a_code"]);
    expect(KNOWN_SHORT_CODES).not.toContain("not_a_code");
  });

  it("has unique kebab ids and titles", () => {
    const ids = AUTOMATION_TEMPLATES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    const titles = AUTOMATION_TEMPLATES.map((t) => t.title);
    expect(new Set(titles).size).toBe(titles.length);
  });

  it("groups the recipes in the order the sections are declared", () => {
    const seen = AUTOMATION_TEMPLATES.map((t) => AUTOMATION_TEMPLATE_SECTIONS.indexOf(t.section));
    expect(seen).toEqual([...seen].sort((a, b) => a - b));
    expect(seen).not.toContain(-1);
    // Every section has something in it — an empty heading is a dead end.
    for (const section of AUTOMATION_TEMPLATE_SECTIONS) {
      expect(AUTOMATION_TEMPLATES.some((t) => t.section === section)).toBe(true);
    }
  });

  it("ships the nine recipes the research backs, and nothing else", () => {
    expect(AUTOMATION_TEMPLATES.map((t) => t.id)).toEqual([
      "job-canceled-notify-techs",
      "job-scheduled-notify-techs",
      "missed-call-text-client",
      "missed-call-notify-office",
      "completed-call-text-client",
      "voicemail-text-client",
      "one-hour-notice-client-reminder",
      "one-hour-notice-tech-reminder",
      "collect-reviews-1-day-after",
    ]);
  });

  it.each(AUTOMATION_TEMPLATES.map((t) => [t.id, t] as const))("%s parses with the editor's schema", (_id, t) => {
    const parsed = automationFormSchema.safeParse(specToForm(t.draft.name, t.draft.spec));
    expect(parsed.error?.issues[0]?.message).toBeUndefined();
    expect(parsed.success).toBe(true);
  });

  it.each(AUTOMATION_TEMPLATES.map((t) => [t.id, t] as const))(
    "%s round-trips through the editor unchanged",
    (_id, t) => {
      const values = automationFormSchema.parse(specToForm(t.draft.name, t.draft.spec));
      // Opening the recipe and saving it without touching anything must store
      // the recipe, not a widened version of it.
      expect(toSpec(values)).toEqual(t.draft.spec);
      expect(values.name).toBe(t.draft.name);
    },
  );

  it.each(AUTOMATION_TEMPLATES.map((t) => [t.id, t] as const))("%s sends a message, with a body", (_id, t) => {
    expect(t.draft.spec.actions.length).toBeGreaterThan(0);
    for (const action of t.draft.spec.actions) {
      expect(action.type).toBe("send_sms");
      expect(action.body?.trim()).toBeTruthy();
    }
  });

  it.each(AUTOMATION_TEMPLATES.map((t) => [t.id, t] as const))("%s uses only real short codes", (_id, t) => {
    for (const code of codesIn(bodiesOf(t.draft.spec))) expect(KNOWN_SHORT_CODES).toContain(code);
  });

  it.each(AUTOMATION_TEMPLATES.map((t) => [t.id, t] as const))(
    "%s pins no id this workspace owns",
    (_id, t) => {
      // Statuses are the exception: a super-status is an enum every workspace
      // shares, which is why the editor can offer it in a fixed list.
      const superStatuses = Object.values(JobSuperStatus) as string[];
      for (const value of idsIn(t.draft.spec)) expect(superStatuses).toContain(value);
    },
  );

  it.each(AUTOMATION_TEMPLATES.map((t) => [t.id, t] as const))("%s marks the slots a person edits", (_id, t) => {
    expect(t.sentence).toMatch(/<[^<>]+>/);
    // Balanced markers, and no empty one — the card renders them as underlined
    // text and a stray bracket would swallow half the sentence.
    expect((t.sentence.match(/</g) ?? []).length).toBe((t.sentence.match(/>/g) ?? []).length);
    expect(t.sentence).not.toMatch(/<>/);
    expect(t.blurb.length).toBeGreaterThan(0);
    expect(t.blurb).not.toMatch(/[<>]/);
  });

  it("stays out of money, leads and service plans", () => {
    const outOfScope = /invoice|estimate|payment|deposit|lead|service plan|visit/i;
    for (const t of AUTOMATION_TEMPLATES) {
      expect(`${t.id} ${t.title} ${t.sentence} ${t.blurb}`).not.toMatch(outOfScope);
      expect(t.draft.spec.conditions.map((c) => c.field)).not.toContain("paymentStatus");
    }
  });

  it("carries the timing the recipe names", () => {
    const byId = new Map(AUTOMATION_TEMPLATES.map((t) => [t.id, t]));
    expect(byId.get("collect-reviews-1-day-after")?.draft.spec.timing?.delayMinutes).toBe(1440);
    for (const id of ["one-hour-notice-client-reminder", "one-hour-notice-tech-reminder"]) {
      const trigger = byId.get(id)?.draft.spec.trigger;
      expect(trigger?.kind).toBe("schedule.relative");
      expect(trigger?.anchor).toBe("scheduledStart");
      expect(trigger?.offsetMinutes).toBe(-60);
    }
  });
});
