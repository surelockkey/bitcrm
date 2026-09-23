import { ScanCommand } from '@aws-sdk/lib-dynamodb';
import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

/**
 * "Is any job still naming this catalog entry?" — the question that decides
 * whether an entry may be deleted or must only be archived.
 *
 * It has to be asked carefully. DynamoDB applies `Limit` to the rows it READS
 * and the FilterExpression only afterwards, so a check written as `Limit: 1`
 * reads a single row of the table and answers from that: across 1.25M rows the
 * answer came back "not referenced" almost every time. A job type in daily use
 * could then be deleted, and every job naming it would show no type at all.
 *
 * So: read a page at a time, stop at the first hit, and say "no" only once the
 * table has actually ended. The walk is bounded — past `maxPages` the honest
 * answer is "assume it is in use", because refusing a delete is the safe way
 * to be wrong.
 *
 * The filter comes from the caller: a catalog is referenced by a plain
 * attribute (`jobTypeId`), by membership of a list (`tagIds`) or by a key
 * inside a map (`customFields`), and only the paging is shared.
 */

/** Rows evaluated per page; the filter runs after this many are read. */
const PAGE = 500;
/** Pages one check may read before assuming the entry is in use. */
const MAX_PAGES = 200;

export interface ReferenceFilter {
  expression: string;
  names: Record<string, string>;
  values?: Record<string, unknown>;
}

/** The id sits in an attribute of its own. */
export function equals(attribute: string, id: string): ReferenceFilter {
  return { expression: '#ref = :id', names: { '#ref': attribute }, values: { ':id': id } };
}

/** The id is one of several in a list. */
export function listContains(attribute: string, id: string): ReferenceFilter {
  return { expression: 'contains(#ref, :id)', names: { '#ref': attribute }, values: { ':id': id } };
}

/** The id IS the key inside a map, so there is nothing to compare it to. */
export function mapKeyExists(attribute: string, key: string): ReferenceFilter {
  return {
    expression: 'attribute_exists(#ref.#key)',
    names: { '#ref': attribute, '#key': key },
    values: undefined,
  };
}

export async function isReferencedByDeal(
  client: DynamoDBDocumentClient,
  table: string,
  filter: ReferenceFilter,
  options: { maxPages?: number } = {},
): Promise<boolean> {
  const maxPages = options.maxPages ?? MAX_PAGES;
  let cursor: Record<string, unknown> | undefined;
  let pages = 0;

  do {
    const result = await client.send(
      new ScanCommand({
        TableName: table,
        FilterExpression: filter.expression,
        ExpressionAttributeNames: filter.names,
        ...(filter.values ? { ExpressionAttributeValues: filter.values } : {}),
        Limit: PAGE,
        ...(cursor ? { ExclusiveStartKey: cursor } : {}),
      }),
    );
    if ((result.Items?.length ?? 0) > 0) return true;
    cursor = result.LastEvaluatedKey;
    pages += 1;
    if (cursor && pages >= maxPages) return true;
  } while (cursor);

  return false;
}
