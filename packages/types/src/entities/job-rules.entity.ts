/**
 * Account-wide job rules — Workiz's Account → Preferences switches that
 * change what happens to a job, kept apart from Field Validation (which only
 * gates creation). One row in the deals table (`CONFIG#JOB_RULES`), read by
 * the deal service where the rule applies and shown on Settings → Account
 * Preferences.
 */
export interface JobRulesSettings {
  /**
   * Workiz "Update Job End Time": when a job is marked Done or Canceled, its
   * end moves to the closing moment (the end date and time, the imported
   * `jobEndDateUtc`, and so the EndIndex the "Job end date" reports read).
   * The start stays where it was, as in Workiz. ON by default, as on the
   * account the data came from.
   */
  updateJobEndTimeOnClose: boolean;
}

export const DEFAULT_JOB_RULES_SETTINGS: JobRulesSettings = {
  updateJobEndTimeOnClose: true,
};
