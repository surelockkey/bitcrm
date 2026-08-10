import { type CustomFieldType } from '../enums/custom-field-type.enum';

/**
 * A user-defined field attached to deals, managed as a catalog in Settings.
 * Definitions are grouped under free-text headings and scoped to job types;
 * a deal stores its answers in `Deal.customFields`, keyed by definition id.
 *
 * Mirrors the JobType / DealSubStatus catalog shape (priority/active plus
 * audit fields) so it shares the same repository and settings-UI conventions.
 */
export interface CustomFieldDefinition {
  id: string;
  name: string;
  /** Input kind; drives both validation and the rendered control. */
  type: CustomFieldType;
  /** Free-text heading this field is filed under in the form/settings UI. */
  group: string;
  /** Predefined choices for `dropdown` / `multi_select`; unused otherwise. */
  options?: string[];
  /** Job-type ids this field applies to. `[]` means All Job Types. */
  jobTypeIds: string[];
  /** Field must be filled to save the deal. */
  required: boolean;
  /** Field must be filled before the deal can be closed. */
  requiredToClose: boolean;
  /** Value is indexed for search. */
  searchable: boolean;
  /** Higher sorts first within its group; also the list sort key. */
  priority: number;
  /** Archived fields stay resolvable on historical deals but leave the forms. */
  active: boolean;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

/** A single answer stored against a custom-field definition on a deal. */
export type CustomFieldValue = string | number | boolean | string[];
