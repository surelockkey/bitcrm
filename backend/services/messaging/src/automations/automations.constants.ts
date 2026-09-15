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
