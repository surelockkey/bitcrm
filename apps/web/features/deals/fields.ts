/**
 * Hideable columns of the Jobs table. The job number is intentionally not
 * here — it carries the row's open-in-new-tab link, so it always renders.
 */
export const JOB_FIELDS = [
  { id: "client", label: "Client" },
  { id: "tech", label: "Tech" },
  { id: "tags", label: "Tags" },
  { id: "location", label: "Location" },
  { id: "scheduled", label: "Scheduled" },
  { id: "jobType", label: "Job type" },
] as const;

export type JobFieldId = (typeof JOB_FIELDS)[number]["id"];

export type VisibleFields = Record<JobFieldId, boolean>;

export const DEFAULT_VISIBLE: VisibleFields = Object.fromEntries(
  JOB_FIELDS.map((f) => [f.id, true]),
) as VisibleFields;

/**
 * Coerce whatever came out of localStorage into a valid visibility map:
 * unknown keys are dropped, missing or non-boolean values fall back to
 * defaults. Keeps stale persisted state from ever breaking the page.
 */
export function sanitizeVisibleFields(raw: unknown): VisibleFields {
  const source = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
  return Object.fromEntries(
    JOB_FIELDS.map((f) => {
      const v = source[f.id];
      return [f.id, typeof v === "boolean" ? v : DEFAULT_VISIBLE[f.id]];
    }),
  ) as VisibleFields;
}
