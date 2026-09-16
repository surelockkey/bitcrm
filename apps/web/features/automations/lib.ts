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
