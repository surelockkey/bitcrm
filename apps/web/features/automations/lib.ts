import {
  automationSentence,
  type AutomationLabelMap,
  type AutomationRule,
  type AutomationRun,
  type AutomationRunOutcome,
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

/** "2 sent, 1 skipped" — the one-line summary of a firing. */
export function runSummary(run: AutomationRun): string {
  if (!run.actions?.length) return run.reason ?? OUTCOME_LABEL[run.outcome];
  const counts = new Map<string, number>();
  for (const action of run.actions) counts.set(action.outcome, (counts.get(action.outcome) ?? 0) + 1);
  return [...counts.entries()].map(([outcome, n]) => `${n} ${outcome.replace(/_/g, " ")}`).join(", ");
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
