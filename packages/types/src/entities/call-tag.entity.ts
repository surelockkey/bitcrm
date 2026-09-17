import { type JobTagColor } from '../enums/job-tag-color.enum';

/**
 * A colored label a call can be tagged with (Tech Call, SPAM CALLER, WRONG
 * NUMBER, …), managed as a catalog under telephony settings — the Workiz
 * "call tag" (tag type 3). A call carries many; the palette is shared with job
 * tags so one chip style serves both.
 *
 * Deletion is an archive: the calls table is an append-only log of millions of
 * rows, so "is this tag still used?" cannot be answered cheaply, and a
 * historical call must keep resolving its labels.
 */
export interface CallTag {
  id: string;
  name: string;
  /** Palette token (see JOB_TAG_COLORS); the UI maps it to chip classes. */
  color: JobTagColor;
  /** Higher sorts first in pickers; also the list sort key. */
  priority: number;
  /** Archived tags stay resolvable on historical calls but leave the pickers. */
  active: boolean;
  /**
   * Where the row came from when it was imported — `workiz:tag:<id>` for a
   * Workiz call tag. Absent on tags created in BitCRM.
   */
  externalId?: string;
  createdBy: string;
  createdAt: string;
  updatedBy?: string;
  updatedAt: string;
}

/** Bounds shared by the API's validation and the UI's affordances. */
export const CALL_TAG_LIMITS = {
  nameMaxLength: 60,
  /** Item-size guard; Workiz calls rarely carry more than three. */
  maxPerCall: 25,
} as const;
