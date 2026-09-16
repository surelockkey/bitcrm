/**
 * Keys of the automations module (design §3.2 `AUTOMATION#`, §10 M21).
 *
 *   AUTOMATION#<ruleId>  / METADATA            the rule; catalog on GSI3 (below)
 *   AUTOSENT#<dealId>    / <ruleId>#<techId>   "this rule already texted this technician about
 *                                              this job" marker — what makes the New-job SMS
 *                                              fire once per assignment and again only on a
 *                                              reschedule (carries the scheduledDate it was sent for)
 *
 * Rules are listed through the same GSI3 catalog partition habit as
 * templates (`CATALOG#MESSAGE_TEMPLATE`): a constant partition key, no
 * extra index, no Scan. Rows the history loader writes must carry these two
 * attributes to show up in the list.
 */
export const AUTOMATION_CATALOG_GSI3PK = 'CATALOG#AUTOMATION';

/** `<name lower>#<id>` — alphabetical, unique per rule. */
export const automationCatalogSk = (name: string, ruleId: string) =>
  `${name.trim().toLowerCase()}#${ruleId}`;

/** `AUTOSENT#<dealId>` — one partition per job for the sent markers. */
export const autoSentPk = (dealId: string) => `AUTOSENT#${dealId}`;
/** `<ruleId>#<techId>` under the job. */
export const autoSentSk = (ruleId: string, techId: string) => `${ruleId}#${techId}`;

/** `updatedBy` / `createdBy` / `sentByUserId` stamp of everything the automations write. */
export const AUTOMATIONS_ACTOR = 'system:automations';

// ---------------------------------------------------------------------------
// Rule engine (M21 L). One partition per rule holds both halves of a firing:
//
//   AUTORUN#<ruleId> / RUN#<firedAt>#<runId>       the log the Automation Center shows (TTL 30 d)
//   AUTORUN#<ruleId> / ONCE#<entity>#<occurrence>  "this rule already handled this" (TTL 90 d)
//   SCHEDULE#<YYYY-MM-DDTHH:MM> / <ruleId>#<entity>#<occurrence>
//                                                  a delayed / relative firing due that minute (TTL 30 d)
//
// A rule's runs are read newest-first with one Query and no index; the
// per-rule partition is written at most once per firing, which at Workiz's
// own volume (66 632 firings over four years, the busiest rule 17 476) is
// far under a partition's write budget.
// ---------------------------------------------------------------------------
export const autoRunPk = (ruleId: string) => `AUTORUN#${ruleId}`;
export const AUTO_RUN_SK_PREFIX = 'RUN#';
/** `RUN#<firedAt>#<runId>` — time-ordered inside the rule's partition. */
export const autoRunSk = (firedAt: string, runId: string) => `${AUTO_RUN_SK_PREFIX}${firedAt}#${runId}`;
export const AUTO_ONCE_SK_PREFIX = 'ONCE#';
/** `ONCE#<entity>#<occurrence>` — the idempotency marker of one firing. */
export const autoOnceSk = (entity: string, occurrence: string) =>
  `${AUTO_ONCE_SK_PREFIX}${entity}#${occurrence}`;

export const AUTO_RUN_TTL_SECONDS = 30 * 24 * 60 * 60;
/** Longer than the log: re-firing a rule for a job is worse than losing its history. */
export const AUTO_ONCE_TTL_SECONDS = 90 * 24 * 60 * 60;

/** `SCHEDULE#<YYYY-MM-DDTHH:MM>` — every firing due in that UTC minute. */
export const schedulePk = (dueMinute: string) => `SCHEDULE#${dueMinute}`;
/** `<ruleId>#<entity>#<occurrence>` — the identity the run log dedupes on. */
export const scheduleSk = (ruleId: string, entity: string, occurrence: string) =>
  `${ruleId}#${entity}#${occurrence}`;
/** ISO instant → the UTC minute bucket it falls in (`2026-09-16T13:45`). */
export const dueMinuteOf = (iso: string) => iso.slice(0, 16);
export const SCHEDULE_TTL_SECONDS = 30 * 24 * 60 * 60;

/** `DEALSNAP#<dealId>` / METADATA — the last schedule we saw, for reschedule detection. */
export const dealSnapshotPk = (dealId: string) => `DEALSNAP#${dealId}`;
/** A job nobody has touched in half a year cannot be "rescheduled" in any useful sense. */
export const DEAL_SNAPSHOT_TTL_SECONDS = 180 * 24 * 60 * 60;
