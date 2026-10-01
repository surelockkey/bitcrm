import { type JobTagColor } from '../enums/job-tag-color.enum';

/**
 * A colored label a client can be tagged with (PLATINUM, tax free, …), as
 * Workiz's client tags: managed in Settings, picked on the client card. A
 * client carries many (`Contact.tagIds`); each tag has a palette color shared
 * with job tags.
 */
export interface ClientTag {
  id: string;
  name: string;
  /** Palette token (see JOB_TAG_COLORS); the UI maps it to chip classes. */
  color: JobTagColor;
  /** Higher sorts first in pickers; also the list sort key. */
  priority: number;
  /** Archived tags stay resolvable on the clients that carry them but leave the pickers. */
  active: boolean;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}
