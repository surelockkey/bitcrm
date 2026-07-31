import { type JobTagColor } from '../enums/job-tag-color.enum';
import { type DealStageGroup } from '../enums/deal-stage.enum';

/**
 * A custom, colored job status a deal can be labelled with, managed as a catalog
 * in Settings. Each one lives under a fixed super-status (the pipeline
 * `DealStageGroup` — Submitted / In Progress / Pending / Closed), mirroring the
 * grouped status dropdown dispatchers used in the old CRM.
 *
 * This is purely a display/reporting label: it sits ALONGSIDE the deal's
 * `stage`, which still drives the board and transition rules. Like JobTag it
 * reuses the shared color palette and touches nothing but deals.
 */
export interface DealSubStatus {
  id: string;
  name: string;
  /** The built-in super-status (pipeline group) this sub-status is filed under. */
  group: DealStageGroup;
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
