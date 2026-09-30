import { Injectable } from '@nestjs/common';
import { QueryCommand } from '@aws-sdk/lib-dynamodb';
import { DynamoDbService } from '@bitcrm/shared';
import { CALLS_GSI2_NAME, CALLS_TABLE } from '../../common/constants/dynamo.constants';
import { TRACKED_CALL_ATTRIBUTES, type TrackedCall } from './call-tracking';

const DAY_MS = 86_400_000;
/** Queries in flight at once. */
const DEFAULT_CONCURRENCY = 12;
/**
 * The read budget of one report, in queries. A year of the log is ~350k rows
 * — ~600 one-megabyte pages plus a query per day slice — so this is roomy for
 * the longest window the report allows, and still a ceiling.
 */
const DEFAULT_BUDGET = 3000;

/** A slice of the window: `[start, end)` inside one month partition. */
export interface WalkSlice {
  pk: string;
  lo: string;
  hi: string;
}

/**
 * The window cut into slices a day long, split again at UTC month starts so
 * each slice is a range inside one `CALL#<YYYY-MM>` partition. The upper
 * bound is the last millisecond before the next slice plus `￿`, which
 * sorts after any `#<sid>` suffix — so slices never overlap and never miss.
 */
export function walkSlices(start: string, end: string): WalkSlice[] {
  const t0 = Date.parse(start);
  const t1 = Date.parse(end);
  if (!(t1 > t0)) return [];
  const cuts = new Set<number>([t0, t1]);
  for (let t = t0 + DAY_MS; t < t1; t += DAY_MS) cuts.add(t);
  const first = new Date(t0);
  for (let y = first.getUTCFullYear(), m = first.getUTCMonth() + 1; ; m += 1) {
    const t = Date.UTC(y, m, 1);
    if (t >= t1) break;
    cuts.add(t);
  }
  const sorted = [...cuts].sort((a, b) => a - b);
  const out: WalkSlice[] = [];
  for (let i = 0; i + 1 < sorted.length; i += 1) {
    const lo = new Date(sorted[i]).toISOString();
    out.push({
      pk: `CALL#${lo.slice(0, 7)}`,
      lo,
      hi: `${new Date(sorted[i + 1] - 1).toISOString()}￿`,
    });
  }
  return out;
}

/**
 * Reads the inbound calls of a window off the month-partitioned log
 * (AllCallsIndex, `CALL#<YYYY-MM>` / `<startedAt>#<sid>`) — never a Scan.
 *
 * The filter keeps inbound, non-internal calls, but DynamoDB charges for every
 * row it reads before filtering (outbound calls are two thirds of the log),
 * so the walk is cut into day slices run in parallel: a month is ~30 short
 * range queries instead of one long sequential crawl. Out of budget, it stops
 * and says so (`atLeast`).
 */
@Injectable()
export class CallTrackingRepository {
  private readonly tableName = CALLS_TABLE;

  constructor(private readonly dynamoDb: DynamoDbService) {}

  async walk(
    window: { start: string; end: string },
    onCall: (call: TrackedCall) => void,
    opts: { concurrency?: number; budget?: number } = {},
  ): Promise<{ atLeast: boolean; queries: number }> {
    const slices = walkSlices(window.start, window.end);
    const budget = opts.budget ?? DEFAULT_BUDGET;
    const names: Record<string, string> = { '#direction': 'direction' };
    const projection = TRACKED_CALL_ATTRIBUTES.map((attr, i) => {
      names[`#p${i}`] = attr;
      return `#p${i}`;
    });
    let queries = 0;
    let atLeast = false;
    let next = 0;

    const worker = async () => {
      for (;;) {
        const slice = slices[next];
        next += 1;
        if (!slice) return;
        let startKey: Record<string, unknown> | undefined;
        do {
          if (queries >= budget) {
            atLeast = true;
            return;
          }
          queries += 1;
          const res = await this.dynamoDb.client.send(
            new QueryCommand({
              TableName: this.tableName,
              IndexName: CALLS_GSI2_NAME,
              KeyConditionExpression: 'GSI2PK = :pk AND GSI2SK BETWEEN :lo AND :hi',
              FilterExpression: '#direction = :inbound AND attribute_not_exists(internalLegOf)',
              ProjectionExpression: projection.join(', '),
              ExpressionAttributeNames: names,
              ExpressionAttributeValues: {
                ':pk': slice.pk,
                ':lo': slice.lo,
                ':hi': slice.hi,
                ':inbound': 'inbound',
              },
              ...(startKey && { ExclusiveStartKey: startKey }),
            }),
          );
          for (const item of res.Items ?? []) onCall(item as TrackedCall);
          startKey = res.LastEvaluatedKey;
        } while (startKey);
      }
    };

    const concurrency = Math.max(1, Math.min(opts.concurrency ?? DEFAULT_CONCURRENCY, slices.length || 1));
    await Promise.all(Array.from({ length: concurrency }, worker));
    return { atLeast, queries };
  }
}
