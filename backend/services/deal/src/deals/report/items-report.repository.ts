import { Injectable, Logger } from '@nestjs/common';
import { GetCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { DynamoDbService } from '@bitcrm/shared';
import { DEALS_GSI7_NAME, DEALS_TABLE } from '../../common/constants/dynamo.constants';
import { DONE_LINES_PREFIX, DONE_LINES_STATE_KEY, doneLinesReadRange } from '../done-lines-index';

/** Jobs whose lines are read at once. A month of Done jobs (~1 100) is ~45 rounds. */
export const LINES_PARALLEL = 24;
/** How often a not-yet-ready Done-lines index is asked about again. */
const DONE_LINES_READY_RECHECK_MS = 60_000;

/**
 * The lines of many jobs, for the Items and services report.
 *
 * A job's lines live under the job: `PK = DEAL#<dealId>`, `SK = PRODUCT#<lineId>`
 * (see `DealProductsRepository`). There is no index across jobs' lines, and
 * the report needs no new one: it knows its jobs from the window read, so it
 * asks each job's partition — one Query per job, `LINES_PARALLEL` at a time,
 * projected to the attributes the report reads. Never a Scan.
 *
 * Once the Done-lines keys are in (`deals/done-lines-index.ts`, readiness row
 * `DONELINESINDEX / STATE`), `linesOfWindow` reads the same rows one month
 * partition at a time instead — a quarter is three Queries, not ~3 000.
 */
@Injectable()
export class ItemsReportRepository {
  private readonly logger = new Logger(ItemsReportRepository.name);
  private readonly tableName = DEALS_TABLE;
  /** `doneLinesIndexReady`'s answer and when it was read; `true` is kept for good. */
  private doneLinesReady?: { ready: boolean; at: number };

  constructor(private readonly dynamoDb: DynamoDbService) {}

  /**
   * Whether the Done-lines keys may be read: the backfill's readiness row
   * exists. Asked again at most once a minute while it does not; once it
   * does, kept for the life of the process. A failed read is "not ready".
   */
  async doneLinesIndexReady(now: number = Date.now()): Promise<boolean> {
    const known = this.doneLinesReady;
    if (known?.ready) return true;
    if (known && now - known.at < DONE_LINES_READY_RECHECK_MS) return false;
    let ready = false;
    try {
      const res = await this.dynamoDb.client.send(new GetCommand({ TableName: this.tableName, Key: { ...DONE_LINES_STATE_KEY } }));
      ready = typeof res.Item?.readyAt === 'string';
    } catch (err) {
      this.logger.warn(`done-lines readiness unreadable — treated as not ready: ${(err as Error).message}`);
    }
    this.doneLinesReady = { ready, at: now };
    return ready;
  }

  /**
   * Every `PRODUCT#` row of every Done job the window `from`..`to` can hold,
   * keyed by job id — off the EndIndex's `DONELINES#<month>` partitions, one
   * Query per month (paged to its end), all months at once. A job's rows come
   * back in its partition's order (by line key), once each.
   *
   * It may hold jobs the report will not count (the range has a margin; the
   * report keeps only the lines of the jobs its window read returned).
   * `null` when the index is not ready or could not be read: the caller then
   * reads job by job (`linesOf`), exactly as before.
   */
  async linesOfWindow(
    from: string,
    to: string,
    projection: readonly string[],
  ): Promise<Map<string, Record<string, unknown>[]> | null> {
    if (!(await this.doneLinesIndexReady())) return null;
    const names: Record<string, string> = { '#pk': 'GSI7PK', '#sk': 'GSI7SK', '#rowPk': 'PK' };
    const projected = ['#rowPk', ...projection.map((attr, i) => {
      names[`#p${i}`] = attr;
      return `#p${i}`;
    })].join(', ');
    const { months, lo, hi } = doneLinesReadRange(from, to);
    try {
      const pages = await Promise.all(
        months.map(async (month) => {
          const rows: Record<string, unknown>[] = [];
          let startKey: Record<string, unknown> | undefined;
          do {
            const res = await this.dynamoDb.client.send(
              new QueryCommand({
                TableName: this.tableName,
                IndexName: DEALS_GSI7_NAME,
                KeyConditionExpression: '#pk = :pk AND #sk BETWEEN :lo AND :hi',
                ExpressionAttributeNames: names,
                ExpressionAttributeValues: { ':pk': `${DONE_LINES_PREFIX}${month}`, ':lo': lo, ':hi': hi },
                ProjectionExpression: projected,
                ExclusiveStartKey: startKey,
              }),
            );
            for (const item of res.Items ?? []) rows.push(item);
            startKey = res.LastEvaluatedKey;
          } while (startKey);
          return rows;
        }),
      );
      const out = new Map<string, Record<string, unknown>[]>();
      const seen = new Set<string>();
      for (const row of pages.flat()) {
        const pk = String(row.PK ?? '');
        if (!pk.startsWith('DEAL#')) continue;
        const key = `${pk}|${String(row.SK)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const id = pk.slice('DEAL#'.length);
        const list = out.get(id);
        if (list) list.push(row);
        else out.set(id, [row]);
      }
      // A job's lines in its own partition's order, as `linesOf` returns them.
      for (const list of out.values()) list.sort((a, b) => (String(a.SK) < String(b.SK) ? -1 : String(a.SK) > String(b.SK) ? 1 : 0));
      return out;
    } catch (err) {
      this.logger.warn(`done-lines index unreadable — reading job by job: ${(err as Error).message}`);
      return null;
    }
  }

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
