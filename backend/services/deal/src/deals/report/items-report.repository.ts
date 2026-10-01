import { Injectable } from '@nestjs/common';
import { QueryCommand } from '@aws-sdk/lib-dynamodb';
import { DynamoDbService } from '@bitcrm/shared';
import { DEALS_TABLE } from '../../common/constants/dynamo.constants';

/** Jobs whose lines are read at once. A month of Done jobs (~1 100) is ~45 rounds. */
export const LINES_PARALLEL = 24;

/**
 * The lines of many jobs, for the Items and services report.
 *
 * A job's lines live under the job: `PK = DEAL#<dealId>`, `SK = PRODUCT#<lineId>`
 * (see `DealProductsRepository`). There is no index across jobs' lines, and
 * the report needs no new one: it knows its jobs from the window read, so it
 * asks each job's partition — one Query per job, `LINES_PARALLEL` at a time,
 * projected to the attributes the report reads. Never a Scan.
 */
@Injectable()
export class ItemsReportRepository {
  private readonly tableName = DEALS_TABLE;

  constructor(private readonly dynamoDb: DynamoDbService) {}

  /** Every `PRODUCT#` row of each job, keyed by the job's id. A job with no lines is absent. */
  async linesOf(dealIds: readonly string[], projection: readonly string[]): Promise<Map<string, Record<string, unknown>[]>> {
    const names: Record<string, string> = { '#pk': 'PK', '#sk': 'SK' };
    const projected = projection
      .map((attr, i) => {
        names[`#p${i}`] = attr;
        return `#p${i}`;
      })
      .join(', ');
    const out = new Map<string, Record<string, unknown>[]>();
    const ids = [...new Set(dealIds.filter(Boolean))];
    let next = 0;
    const worker = async (): Promise<void> => {
      while (next < ids.length) {
        const id = ids[next++];
        const rows: Record<string, unknown>[] = [];
        let startKey: Record<string, unknown> | undefined;
        do {
          const res = await this.dynamoDb.client.send(
            new QueryCommand({
              TableName: this.tableName,
              KeyConditionExpression: '#pk = :pk AND begins_with(#sk, :sk)',
              ExpressionAttributeNames: names,
              ExpressionAttributeValues: { ':pk': `DEAL#${id}`, ':sk': 'PRODUCT#' },
              ...(projected && { ProjectionExpression: projected }),
              ExclusiveStartKey: startKey,
            }),
          );
          for (const item of res.Items ?? []) rows.push(item);
          startKey = res.LastEvaluatedKey;
        } while (startKey);
        if (rows.length) out.set(id, rows);
      }
    };
    await Promise.all(Array.from({ length: Math.min(LINES_PARALLEL, ids.length) }, worker));
    return out;
  }
}
