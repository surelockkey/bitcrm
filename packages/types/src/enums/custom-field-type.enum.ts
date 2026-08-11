/**
 * The fixed set of input kinds a custom field can take. One source of truth:
 * the backend validates against it (`@IsIn(CUSTOM_FIELD_TYPES)`) and the web
 * renders the matching control. `dropdown` and `multi_select` are the only
 * types that carry a predefined `options` list.
 */
export const CUSTOM_FIELD_TYPES = [
  'text',
  'large_text',
  'number',
  'checkbox',
  'dropdown',
  'date',
  'file',
  'multi_select',
] as const;

export type CustomFieldType = (typeof CUSTOM_FIELD_TYPES)[number];

/** Field types whose definition carries a predefined `options` list. */
export const OPTION_CUSTOM_FIELD_TYPES: readonly CustomFieldType[] = [
  'dropdown',
  'multi_select',
];

/** True when the type is option-backed (dropdown / multi_select). */
export function isOptionCustomFieldType(type: CustomFieldType): boolean {
  return OPTION_CUSTOM_FIELD_TYPES.includes(type);
}
