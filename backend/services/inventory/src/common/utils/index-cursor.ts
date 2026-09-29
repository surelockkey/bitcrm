import { BadRequestException } from '@nestjs/common';

/**
 * Page cursors of an index Query are the `LastEvaluatedKey` — the table keys
 * plus the index keys — base64url-encoded. DynamoDB rejects an
 * `ExclusiveStartKey` that lacks the index keys with a ValidationException,
 * which the exception filter would surface as a 500. A cursor from the
 * Scan-era list (table keys only, cached in a tab open across the deploy) or
 * a hand-edited one is therefore refused here with a 400 instead.
 */
export function encodeIndexCursor(lastEvaluatedKey?: Record<string, unknown>): string | undefined {
  if (!lastEvaluatedKey) return undefined;
  return Buffer.from(JSON.stringify(lastEvaluatedKey)).toString('base64url');
}

export function decodeIndexCursor(
  cursor: string | undefined,
  requiredKeys: readonly string[],
): Record<string, unknown> | undefined {
  if (!cursor) return undefined;

  let key: unknown;
  try {
    key = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf-8'));
  } catch {
    throw new BadRequestException('Invalid cursor');
  }
  if (typeof key !== 'object' || key === null) throw new BadRequestException('Invalid cursor');

  const record = key as Record<string, unknown>;
  for (const attr of requiredKeys) {
    if (typeof record[attr] !== 'string') throw new BadRequestException('Invalid cursor');
  }
  return record;
}
