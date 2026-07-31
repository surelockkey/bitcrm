import { type JobTagColor } from '../enums/job-tag-color.enum';
import { type JobSuperStatus } from '../enums/deal-stage.enum';

/**
 * A custom, colored job sub-status, managed as a catalog in Settings. Each one
 * lives under a fixed super-status (`JobSuperStatus` — Submitted / In Progress /
 * Done / Pending / Done pending approval / Canceled), mirroring the grouped
 * status dropdown dispatchers used in the old CRM.
 *
 * A deal carries a `superStatus` plus, optionally, one of these sub-statuses.
 * Like JobTag it reuses the shared color palette and touches nothing but deals.
 */
export interface DealSubStatus {
  id: string;
  name: string;
  /** The built-in super-status this sub-status is filed under. */
  group: JobSuperStatus;
  /** Palette token (see JOB_TAG_COLORS); the UI maps it to a colored dot/chip. */
  color: JobTagColor;
  /** Higher sorts first within its group in pickers; also the list sort key. */
  priority: number;
  /** Archived statuses stay resolvable on historical deals but leave the pickers. */
  active: boolean;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}
