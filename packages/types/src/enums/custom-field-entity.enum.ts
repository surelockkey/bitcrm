import { type CustomFieldType } from './custom-field-type.enum';

/**
 * What a custom field is filed against — Workiz's Settings → Custom Fields
 * tabs, "Job/Lead" and "Client". A job field's answers live on the deal
 * (`Deal.customFields`), a client field's on the contact
 * (`Contact.customFields`); both are keyed by the definition id.
 */
export const CUSTOM_FIELD_ENTITY_TYPES = ['job', 'client'] as const;

export type CustomFieldEntityType = (typeof CUSTOM_FIELD_ENTITY_TYPES)[number];

/**
 * The entity a definition belongs to. Rows written before client fields
 * existed carry no `entityType`: they are job fields.
 */
export function customFieldEntityType(def: { entityType?: string | null }): CustomFieldEntityType {
  return def.entityType === 'client' ? 'client' : 'job';
}

/** An answer counts as "not filled" when it is absent, blank, or an empty list. */
export function isCustomFieldValueEmpty(value: unknown): boolean {
  return (
    value === undefined ||
    value === null ||
    value === '' ||
    (Array.isArray(value) && value.length === 0)
  );
}

/**
 * Runtime shape check of one answer against its definition's type — the
 * rule the deal service applies to a job's answers, shared so a client's are
 * held to the same one. A file answer is an attachment id, or up to five.
 */
export function isCustomFieldValueValid(
  type: CustomFieldType,
  value: unknown,
  options: readonly string[] = [],
): boolean {
  switch (type) {
    case 'text':
    case 'large_text':
    case 'date':
      return typeof value === 'string';
    case 'file':
      return (
        typeof value === 'string' ||
        (Array.isArray(value) && value.length <= 5 && value.every((v) => typeof v === 'string'))
      );
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    case 'checkbox':
      return typeof value === 'boolean';
    case 'dropdown':
      return typeof value === 'string' && options.includes(value);
    case 'multi_select':
      return Array.isArray(value) && value.every((v) => typeof v === 'string' && options.includes(v));
    default:
      return false;
  }
}
