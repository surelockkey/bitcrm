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

/** How long a rule's name may be — what the DTOs enforce and what "(copy 2)" has to fit inside. */
export const AUTOMATION_NAME_MAX_LENGTH = 120;

/** `<name lower>#<id>` — alphabetical, unique per rule. */
export const automationCatalogSk = (name: string, ruleId: string) =>
  `${name.trim().toLowerCase()}#${ruleId}`;

/** `AUTOSENT#<dealId>` — one partition per job for the sent markers. */
export const autoSentPk = (dealId: string) => `AUTOSENT#${dealId}`;
/** `<ruleId>#<techId>` under the job. */
export const autoSentSk = (ruleId: string, techId: string) => `${ruleId}#${techId}`;

/** `updatedBy` / `createdBy` / `sentByUserId` stamp of everything the automations write. */
export const AUTOMATIONS_ACTOR = 'system:automations';

/**
 * The action types the engine actually performs today
 * (`AutomationActionExecutor.run`). `send_email` / `send_in_app` /
 * `add_tag` / `change_sub_status` are typed, translated and editable but
 * answer `unsupported`, so a rule made only of those would fire and do
 * nothing — it is not runnable, whether it came from the translator or from
 * a spec somebody wrote in the Automation Center.
 */
export const EXECUTABLE_ACTION_TYPES = ['send_sms', 'webhook'] as const;

export const NOTHING_EXECUTABLE_REASON = 'only email / in-app actions, which the engine cannot send yet';

export const hasExecutableAction = (actions: ReadonlyArray<{ type?: string }> | undefined): boolean =>
  (actions ?? []).some((a) => (EXECUTABLE_ACTION_TYPES as readonly string[]).includes(a?.type ?? ''));

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

// ---------------------------------------------------------------------------
// The account-wide firing feed (the Activity page).
//
// A run lives in its rule's partition, which answers "what did THIS rule do"
// in one Query and "what did ANY rule do" not at all. Rather than add a
// seventh index — a new GSI is a terraform apply, and nobody may run one
// here — every logged run also lands in the GSI3 catalog the rules
// themselves are listed through, under a month partition:
//
//   GSI3PK = AUTORUN#<YYYY-MM>   GSI3SK = <firedAt>#<runId>
//
// A month of firings is small (Workiz's whole four years came to 66 632, and
// the busiest single rule to 17 476), and the feed reads newest-first
// straight down the partition with no filter.
// ---------------------------------------------------------------------------

/** `AUTORUN#<YYYY-MM>` — every rule's firings of one month, on GSI3. */
export const autoRunFeedGsi3Pk = (month: string) => `AUTORUN#${month}`;
/** `<firedAt>#<runId>` — time-ordered inside the month partition. */
export const autoRunFeedGsi3Sk = (firedAt: string, runId: string) => `${firedAt}#${runId}`;
/** ISO instant → the month partition it belongs to (`2026-09`). */
export const runMonthOf = (iso: string) => iso.slice(0, 7);

/**
 * DynamoDB sweeps expired TTL rows "typically within a few days", not on the
 * second. The feed looks two days further back than the TTL so a run the
 * table still holds is not hidden behind a partition nobody reads.
 */
export const AUTO_RUN_TTL_GRACE_SECONDS = 2 * 24 * 60 * 60;

/** How many Queries one feed page may cost before it returns short with a cursor. */
export const AUTO_RUN_FEED_MAX_QUERIES = 8;

/**
 * The month partitions the feed must read, newest first.
 *
 * Runs expire after `AUTO_RUN_TTL_SECONDS` (30 days), so everything that can
 * still exist fired inside that window — which is why this is two Queries
 * and not a scan. Two, *almost* always: 30 days before 1 March is 30
 * January, two months back, because February is shorter than the window. So
 * the months are derived from the window instead of assumed, and the walk is
 * at most three partitions. `since` only ever shortens it.
 */
export function autoRunFeedMonths(now: Date, since?: string): string[] {
  const horizon = now.getTime() - (AUTO_RUN_TTL_SECONDS + AUTO_RUN_TTL_GRACE_SECONDS) * 1000;
  const asked = since ? Date.parse(since) : Number.NaN;
  const oldest = runMonthOf(new Date(Number.isNaN(asked) ? horizon : Math.max(horizon, asked)).toISOString());

  const months: string[] = [];
  let month = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  // The clamp above keeps this at two or three; the bound is a stop, not a policy.
  while (months.length < 12) {
    const key = runMonthOf(month.toISOString());
    months.push(key);
    if (key <= oldest) break;
    month = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() - 1, 1));
  }
  return months;
}

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
