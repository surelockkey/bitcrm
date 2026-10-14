import { QueryCommand, type DynamoDBDocumentClient, type QueryCommandInput } from '@aws-sdk/lib-dynamodb';

/**
 * Every item a Query matches, following `LastEvaluatedKey` to the end. One
 * Query answers at most 1 MB, so a list read as a single call silently stops
 * at the first page — use this for the catalog partitions (`CATALOG#…`),
 * which are small enough to read whole but not always to fit in one page.
 */
export async function queryAllPages(
  client: Pick<DynamoDBDocumentClient, 'send'>,
  input: Omit<QueryCommandInput, 'ExclusiveStartKey'>,
): Promise<Record<string, unknown>[]> {
  const items: Record<string, unknown>[] = [];
  let startKey: Record<string, unknown> | undefined;
  do {
    const result = await client.send(
      new QueryCommand({ ...input, ...(startKey ? { ExclusiveStartKey: startKey } : {}) }),
    );
    items.push(...((result.Items as Record<string, unknown>[] | undefined) ?? []));
    startKey = result.LastEvaluatedKey;
  } while (startKey);
  return items;
}
