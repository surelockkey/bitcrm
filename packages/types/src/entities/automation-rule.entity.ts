import { type AutomationSpec, type AutomationSpecSource } from './automation-spec';

/**
 * The rules messaging-service executes itself (design §10, M21 minimum):
 * the "New job" SMS to a technician on assignment / reschedule, and the
 * technician-triggered "on my way" / "late" texts to the client. Everything
 * else under `AUTOMATION#` is imported Workiz data; a rule the translator
 * (or a person) gave a `spec` to is run by the rule engine as well.
 */
export const BUILTIN_AUTOMATION_RULE_IDS = ['new-job-sms', 'on-my-way', 'late'] as const;
export type BuiltinAutomationRuleId = (typeof BUILTIN_AUTOMATION_RULE_IDS)[number];

/**
 * One automation rule — `AUTOMATION#<id>` / `METADATA` in the messaging
 * table (design §3.2). Imported rows keep the Workiz structure as-is
 * (`trigger`, `conditions`, `actions`, `events`, `ruleSentence`,
 * `parameters`) with `enabled: false`; the built-in rows carry only what
 * the service reads. `automationRuleId` on a message points at `id`.
 */
export interface AutomationRule {
  id: string;
  name: string;
  /** Whether the service acts on the rule. Only `builtin` rules can be switched on today. */
  enabled: boolean;
  /** One of `BUILTIN_AUTOMATION_RULE_IDS` — executed by messaging-service; absent for imported data. */
  builtin?: boolean;
  description?: string;
  /** Workiz `category` (`job`, `phone`, `lead`, …). */
  category?: string;
  /** Workiz `entities` (`job`, `incoming_call`, `lead`, …). */
  entities?: string[];
  /** Workiz `notifyMedium` (`sms`, `email`, `both`). */
  notifyMedium?: string;
  trigger?: unknown;
  conditions?: unknown;
  actions?: unknown;
  events?: unknown;
  ruleSentence?: unknown;
  parameters?: unknown;
  validFrom?: string;
  /** Raw Workiz state at export time — kept so nothing is lost. */
  workizEnabled?: boolean;
  workizPaused?: boolean;
  workizHidden?: boolean;
  workizDeleted?: boolean;
  workizTriggered?: number;
  source?: 'workiz' | 'bitcrm';
  /** `workiz:automation:<rule_id>` for imported rules. */
  externalId?: string;

  // --- the rule engine (M21 L). Every field below is optional: a row
  // without them is the imported data the earlier milestone stored.

  /** What the engine executes. Absent → the rule is data only and cannot be enabled. */
  spec?: AutomationSpec;
  /** Where `spec` came from — `workiz-translator` specs are recomputed at read time until migrated. */
  specSource?: AutomationSpecSource;
  /** Version of the translator that produced a `workiz-translator` spec (a newer one re-translates). */
  specVersion?: number;
  /** `false` when the Workiz rule has no equivalent here; `notRunnableReason` says why. */
  runnable?: boolean;
  notRunnableReason?: string;
  /** What the translation dropped or guessed — shown in the Automation Center. */
  specNotes?: string[];
  /** How often the BitCRM engine fired it (Workiz's own count stays in `workizTriggered`). */
  firedCount?: number;
  lastFiredAt?: string;
  createdAt: string;
  updatedAt: string;
  createdBy?: string;
  updatedBy?: string;
}
