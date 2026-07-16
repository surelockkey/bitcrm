const DEFAULT_INTERNAL_LIMIT = 200;
const MAX_INTERNAL_LIMIT = 500;

/**
 * Coerce the raw string `limit` query param used by internal indexer endpoints.
 * Params are not transformed by a ValidationPipe in this service, so numeric
 * coercion happens in-handler. Defaults to 200 and clamps to a max of 500.
 */
export function coerceInternalLimit(limit?: string): number {
  const parsed = parseInt(limit ?? '', 10);
  if (Number.isNaN(parsed) || parsed <= 0) return DEFAULT_INTERNAL_LIMIT;
  return Math.min(parsed, MAX_INTERNAL_LIMIT);
}
