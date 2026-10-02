import { registerDecorator, type ValidationOptions } from 'class-validator';

/** More keys than any catalog of custom fields has (Workiz: 10). */
const MAX_KEYS = 200;
const MAX_NAME_LENGTH = 120;
/** Workiz stores the value as text; links and SKU lists fit well inside this. */
const MAX_VALUE_LENGTH = 4000;

/**
 * `customAttributes` on a job line write: an object of custom field NAME →
 * value — the shape inventory takes on a product
 * (inventory products/dto/custom-attributes.validator.ts). A value is a
 * string; `null` or an empty string leaves that field empty. The names are not
 * checked against the definitions: a line keeps whatever its product had (an
 * imported `workiz_attr_<id>` included).
 */
export function IsCustomAttributes(options?: ValidationOptions) {
  return (object: object, propertyName: string) => {
    registerDecorator({
      name: 'isCustomAttributes',
      target: object.constructor,
      propertyName,
      options: {
        message:
          `${propertyName} must be an object of custom field name → text value ` +
          `(null or "" clears a field)`,
        ...options,
      },
      validator: {
        validate(value: unknown): boolean {
          if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
          const entries = Object.entries(value as Record<string, unknown>);
          if (entries.length > MAX_KEYS) return false;
          return entries.every(
            ([key, v]) =>
              key.trim().length > 0 &&
              key.length <= MAX_NAME_LENGTH &&
              (v === null || (typeof v === 'string' && v.length <= MAX_VALUE_LENGTH)),
          );
        },
      },
    });
  };
}
