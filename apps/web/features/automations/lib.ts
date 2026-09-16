import {
  automationSentence,
  type AutomationLabelMap,
  type AutomationRule,
  type AutomationRun,
  type AutomationRunOutcome,
  type AutomationScheduleAnchor,
  type AutomationTriggerKind,
} from "@bitcrm/types";

/** What each trigger is called in the list's filter chips and the editor. */
export const TRIGGER_LABEL: Record<AutomationTriggerKind, string> = {
  "deal.created": "Job created",
  "deal.status_changed": "Job status changes",
  "deal.tech_assigned": "Technician assigned",
  "deal.scheduled_changed": "Job rescheduled",
  "deal.updated": "Job matches",
  "call.completed": "Call ends",
  "message.received": "Message received",
  "schedule.relative": "Before / after the job",
};

/**
 * Whether the thing that fires this rule is a job. A call and an inbound
 * message are not: the engine hands them no deal (`deal-events.handler.ts`
 * builds call facts with no `dealId`), so every recipient read off a job —
 * the dispatcher, the assigned techs — resolves to nobody there.
 */
export function triggerHasJob(kind: AutomationTriggerKind): boolean {
  return kind !== "call.completed" && kind !== "message.received";
}

/** The Workiz `{p6}` slot: the date a relative reminder counts from. */
export const ANCHOR_LABEL: Record<AutomationScheduleAnchor, string> = {
  scheduledStart: "the job's start",
  scheduledEnd: "the job's end",
  statusChangedAt: "the status change",
  createdAt: "when it was created",
};

/**
 * Whether a reminder can be asked for *ahead of* this anchor. Only a job's
 * schedule lies in the future: a job's creation and its last status change
 * have already happened by the time any event reaches the engine, and
 * `armRelative` arms nothing for a moment more than two minutes past
 * (`rule-engine.service.ts` RELATIVE_ARM_GRACE_MINUTES) — so "1 hour ahead
 * of when it was created" is a rule that can never fire.
 */
export function anchorAllowsBefore(anchor: AutomationScheduleAnchor): boolean {
  return anchor === "scheduledStart" || anchor === "scheduledEnd";
}

export const OFFSET_UNITS = ["minutes", "hours", "days"] as const;
export type OffsetUnit = (typeof OFFSET_UNITS)[number];

const UNIT_MINUTES: Record<OffsetUnit, number> = { minutes: 1, hours: 60, days: 1440 };

/** How far the editor lets an offset reach — the spec's own ±30 days. */
export const MAX_OFFSET_MINUTES = 43_200;

export interface OffsetParts {
  value: number;
  unit: OffsetUnit;
  /** Workiz's `{p5}` operator: `ahead` is a negative offset, `after` a positive one. */
  direction: "before" | "after";
}

/** `-60` → `1 hour before`; the largest whole unit, so the editor reads back what was written. */
export function splitOffset(minutes: number | undefined): OffsetParts {
  const total = minutes ?? 0;
  const abs = Math.abs(total);
  const unit: OffsetUnit = abs % 1440 === 0 && abs !== 0 ? "days" : abs % 60 === 0 && abs !== 0 ? "hours" : "minutes";
  return { value: abs / UNIT_MINUTES[unit], unit, direction: total < 0 ? "before" : "after" };
}

/** The inverse of `splitOffset` — what the trigger stores. */
export function joinOffset(parts: OffsetParts): number {
  const magnitude = Math.round(parts.value) * UNIT_MINUTES[parts.unit];
  return parts.direction === "before" ? -magnitude : magnitude;
}

/**
 * A message body split into what the chip editor draws: runs of plain text
 * and atomic short codes. `raw` is the placeholder exactly as it was written
 * — the renderer accepts `{{ job_date }}` and `{{Gate code}}` as readily as
 * `{{job_date}}` (`template-renderer.ts` PLACEHOLDER), and an editor that
 * rewrote them would quietly edit a message nobody asked it to touch.
 */
export type MessageSegment =
  | { type: "text"; text: string }
  | { type: "code"; code: string; raw: string };

const PLACEHOLDER = /\{\{\s*([^{}]+?)\s*\}\}/g;

export function messageSegments(body: string): MessageSegment[] {
  const out: MessageSegment[] = [];
  let at = 0;
  for (const match of body.matchAll(PLACEHOLDER)) {
    const start = match.index ?? 0;
    if (start > at) out.push({ type: "text", text: body.slice(at, start) });
    out.push({ type: "code", code: match[1], raw: match[0] });
    at = start + match[0].length;
  }
  if (at < body.length) out.push({ type: "text", text: body.slice(at) });
  return out;
}

/** The body back, character for character — `segmentsToBody(messageSegments(x)) === x`. */
export function segmentsToBody(segments: MessageSegment[]): string {
  return segments.map((s) => (s.type === "code" ? s.raw : s.text)).join("");
}

/**
 * The Workiz-style sentence for a rule. A rule with a spec says what it
 * does ("When a job has a status of Canceled check, send the assigned tech
 * a text message immediately"); one without falls back to the sentence
 * Workiz itself exported, and then to nothing.
 */
export function ruleSentence(rule: AutomationRule, labels?: AutomationLabelMap): string {
  if (rule.spec) return automationSentence(rule.spec, labels);
  const workiz = rule.ruleSentence as { sentence?: string } | undefined;
  return typeof workiz?.sentence === "string" ? workiz.sentence : "";
}

/** Rules the engine runs, then rules waiting on something, then the rest. */
export function sortRules(rules: AutomationRule[]): AutomationRule[] {
  const rank = (r: AutomationRule) => (r.enabled ? 0 : r.runnable !== false && (r.spec || r.builtin) ? 1 : 2);
  return [...rules].sort(
    (a, b) => rank(a) - rank(b) || (firingCount(b) ?? 0) - (firingCount(a) ?? 0) || a.name.localeCompare(b.name),
  );
}

/** How often it has fired here; `undefined` when it never has. */
export function firingCount(rule: AutomationRule): number | undefined {
  return rule.firedCount ?? undefined;
}

/** Whether the rule can be switched on at all. */
export function canEnable(rule: AutomationRule): boolean {
  return rule.builtin === true || (!!rule.spec && rule.runnable !== false);
}

/** The three buckets the state chips split the list into. */
export type AutomationState = "on" | "off" | "blocked";

export const STATE_LABEL: Record<AutomationState, string> = {
  on: "On",
  off: "Off",
  blocked: "Cannot run",
};

export function ruleState(rule: AutomationRule): AutomationState {
  if (rule.enabled) return "on";
  return canEnable(rule) ? "off" : "blocked";
}

/** A rule that carries no category was written here, not taken from a recipe. */
export const CUSTOM_CATEGORY = "custom";

/**
 * Workiz's `category` is the library section the recipe came from, and it
 * survives copying — so the imported rules already carry the section names.
 */
const CATEGORY_LABEL: Record<string, string> = {
  custom: "Custom",
  followUps: "Follow-ups",
  phone: "Phone",
  reminders: "Reminders",
  marketing: "Marketing",
  actions: "Actions",
  job: "Job status",
};

export function ruleCategory(rule: AutomationRule): string {
  return rule.category || CUSTOM_CATEGORY;
}

/** `followUps` → "Follow-ups"; anything unknown is shown as words. */
export function categoryLabel(category: string): string {
  const known = CATEGORY_LABEL[category];
  if (known) return known;
  const words = category.replace(/[-_]+/g, " ").replace(/([a-z\d])([A-Z])/g, "$1 $2").trim();
  return words ? words[0].toUpperCase() + words.slice(1).toLowerCase() : category;
}

/** The categories actually present in the list, for the filter select. */
export function ruleCategories(rules: AutomationRule[]): string[] {
  return [...new Set(rules.map(ruleCategory))].sort((a, b) =>
    categoryLabel(a).localeCompare(categoryLabel(b)),
  );
}

export type AutomationSort = "used" | "name" | "edited";

export const SORT_LABEL: Record<AutomationSort, string> = {
  used: "Most used",
  name: "Name",
  edited: "Recently edited",
};

export interface AutomationFilter {
  /** Matches the name and the rendered sentence, every word of it. */
  search?: string;
  /** Empty or absent means every state. */
  states?: AutomationState[];
  trigger?: AutomationTriggerKind;
  category?: string;
  sort?: AutomationSort;
}

/** Whether anything but the sort is narrowing the list. */
export function isFiltered(filter: AutomationFilter): boolean {
  return (
    !!filter.search?.trim() || !!filter.states?.length || !!filter.trigger || !!filter.category
  );
}

/**
 * The visible rules, in the chosen order. Pure and client-side: the list is
 * already loaded whole, and with 80 rules — 24 of them near-identical review
 * requests — narrowing it is what makes the page usable (§1.7).
 */
export function filterRules(
  rules: AutomationRule[],
  filter: AutomationFilter,
  labels?: AutomationLabelMap,
): AutomationRule[] {
  const terms = (filter.search ?? "").toLowerCase().split(/\s+/).filter(Boolean);
  const matched = rules.filter((rule) => {
    if (filter.states?.length && !filter.states.includes(ruleState(rule))) return false;
    if (filter.trigger && rule.spec?.trigger.kind !== filter.trigger) return false;
    if (filter.category && ruleCategory(rule) !== filter.category) return false;
    if (!terms.length) return true;
    const haystack = `${rule.name} ${ruleSentence(rule, labels)}`.toLowerCase();
    return terms.every((term) => haystack.includes(term));
  });

  if (filter.sort === "name") return matched.sort((a, b) => a.name.localeCompare(b.name));
  if (filter.sort === "edited") {
    return matched.sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));
  }
  return sortRules(matched);
}

export const OUTCOME_LABEL: Record<AutomationRunOutcome, string> = {
  sent: "Sent",
  partial: "Partly sent",
  skipped: "Skipped",
  failed: "Failed",
  scheduled: "Waiting",
  dry_run: "Test",
  duplicate: "Already sent",
};

export function outcomeTone(outcome: AutomationRunOutcome): "ok" | "warn" | "bad" | "muted" {
  if (outcome === "sent") return "ok";
  if (outcome === "failed") return "bad";
  if (outcome === "partial" || outcome === "scheduled") return "warn";
  return "muted";
}

/**
 * What the engine did with one action of the rule, in the reader's words.
 * The engine's own keys are not that: `unsupported` is a column value, "Not
 * supported here" is the thing that happened.
 */
const ACTION_OUTCOME_LABEL: Record<string, string> = {
  sent: "Sent",
  duplicate: "Already sent",
  skipped: "Not sent",
  failed: "Failed",
  dry_run: "Would send",
  unsupported: "Not supported here",
};

export function actionOutcomeLabel(outcome: string): string {
  return ACTION_OUTCOME_LABEL[outcome] ?? outcome.replace(/_/g, " ");
}

/**
 * "2 sent, 1 not sent" — the one-line summary of a firing. It counts the
 * same outcomes the badges under it name, so it has to say them the same
 * way: a summary reading "1 unsupported" one line above a badge reading
 * "Not supported here" is two different things as far as the reader knows.
 * Lower-cased because this is a tally inside a sentence, not a badge.
 */
export function runSummary(run: AutomationRun): string {
  if (!run.actions?.length) return run.reason ?? OUTCOME_LABEL[run.outcome];
  const counts = new Map<string, number>();
  for (const action of run.actions) counts.set(action.outcome, (counts.get(action.outcome) ?? 0) + 1);
  return [...counts.entries()]
    .map(([outcome, n]) => `${n} ${actionOutcomeLabel(outcome).toLowerCase()}`)
    .join(", ");
}

/** `2026-09-16T15:04:05.000Z` → `Sep 16, 3:04 PM` in the reader's own zone. */
export function formatFiredAt(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** `2024-10-09T…` → `Oct 9, 2024` — the "edited" half of the card's stats. */
export function formatEditedAt(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}
