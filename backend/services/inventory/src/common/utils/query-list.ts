import { Transform } from 'class-transformer';

/** The most values one multi-select filter may carry — well inside DynamoDB's 100 `IN` operands. */
export const MAX_FILTER_VALUES = 50;

/**
 * A multi-select query parameter: repeated (`?category=A&category=B`) it
 * arrives as an array, once as a string — both become a list. Values are
 * never split on commas: a category name may contain one.
 */
export function QueryList(): PropertyDecorator {
  return Transform(({ value }) => {
    if (value === undefined || value === null || value === '') return undefined;
    return (Array.isArray(value) ? value : [value]).map((v) => String(v));
  });
}
