import { type JobTagColor } from '../enums/job-tag-color.enum';

/**
 * A colored label a deal can be tagged with (Rush, Repeat, VIP, …), managed as
 * a catalog in Settings. A deal carries many; each tag has a palette color.
 * Like JobSource, it touches nothing but deals — no technicians or eligibility.
 */
export interface JobTag {
  id: string;
  name: string;
  /** Palette token (see JOB_TAG_COLORS); the UI maps it to chip classes. */
  color: JobTagColor;
  /** Higher sorts first in pickers; also the list sort key. */
  priority: number;
  /** Archived tags stay resolvable on historical deals but leave the pickers. */
  active: boolean;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}
