import { Injectable, Logger } from '@nestjs/common';
import { BatchGetCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { DynamoDbService } from '@bitcrm/shared';
import { DealStatus, JobSuperStatus } from '@bitcrm/types';
import {
  DEALS_TABLE,
  DEALS_GSI1_NAME,
  DEALS_GSI2_NAME,
  DEALS_GSI5_NAME,
} from '../common/constants/dynamo.constants';
import type { CommissionDealItem } from './commission-report.types';

/**
 * The Done jobs of a commissions-report period, read off the deal table's
 * EXISTING indexes and keys — no row of its own, nothing to backfill:
 *
 *   StatusScheduleIndex (GSI5)  GSI5PK = STATUS#done, GSI5SK = <scheduledDate>#<slot>#DEAL#<id>
 *                               — "Closed" and "Scheduled". Workiz's Closed is the END of the
 *                               visit window (`scheduledEndDate`), which is the visit day for
 *                               all but a handful of multi-day jobs, so the start-day range is
 *                               widened back by `lookbackDays` and the end day filtered on.
 *   StageIndex (GSI1)           GSI1PK = STATUS#done, GSI1SK = <createdAt>#DEAL#<id> — "Created".
 *   TechIndex (GSI2)            GSI2PK = TECH#<techId>, GSI2SK = <scheduledDate>#DEAL#<id> on the
 *                               ASSIGN# rows — one technician's period (the Tech report and
 *                               the weekly settlement), then their Done deals by BatchGet.
 *
 * Only the attributes the report reads are projected. The ClosedIndex (GSI6)
 * is keyed by the moment a job turned Done, which is NOT what Workiz's
 * "Closed" means, so this report does not read it.
 */

/** One Query walk stops here and says so; a month of Done jobs is ~10 pages. */
const MAX_PAGES_PER_SEGMENT = 150;
/** A long window is read as parallel slices of this many days. */
const SEGMENT_DAYS = 16;
const BATCH_GET_MAX = 100;

/** The deal attributes a report row is built from. */
const PROJECTED = [
  'id',
  'dealNumber',
  'contactId',
  'invoiceId',
  'assignedTechIds',
  'createdAt',
  'scheduledDate',
  'scheduledEndDate',
  'scheduledTimeSlot',
  'allDay',
  'jobTypeId',
  'address',
  'serviceArea',
  'serviceAreaId',
  'sourceId',
  'externalCompanyId',
  'superStatus',
  'status',
  'totals',
  'jobTotalPrice',
  'taxAmount',
  'tipAmount',
  'parts',
  'companyParts',
  'customFields',
  'useTechSpecialRate',
  'techSpecialRate',
  'techSpecialRateUnit',
  'jobTimezone',
  'commissionSnapshot',
  'clientName',
  'clientCompanyName',
] as const;

const PROJECTION_NAMES: Record<string, string> = Object.fromEntries(PROJECTED.map((a, i) => [`#p${i}`, a]));
const PROJECTION = Object.keys(PROJECTION_NAMES).join(', ');

export interface ItemsRead {
  items: CommissionDealItem[];
  /** A walk ran out of its page budget: the period holds more than was read. */
  truncated: boolean;
}

/** `YYYY-MM-DD` shifted by whole days (UTC arithmetic on a calendar date). */
export function shiftDay(day: string, days: number): string {
  const d = new Date(`${day}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Consecutive `[from, to]` day slices of at most `size` days covering a span. */
export function daySegments(from: string, to: string, size = SEGMENT_DAYS): Array<{ from: string; to: string }> {
  const out: Array<{ from: string; to: string }> = [];
  let start = from;
  while (start <= to && out.length < 400) {
    const end = shiftDay(start, size - 1);
    out.push({ from: start, to: end < to ? end : to });
    start = shiftDay(end, 1);
  }
  return out;
}

@Injectable()
export class CommissionReportRepository {
  private readonly logger = new Logger(CommissionReportRepository.name);

  constructor(private readonly dynamoDb: DynamoDbService) {}

  /**
   * Done jobs whose visit STARTS in `[from, to]` — the schedule index's own
   * key. The caller widens `from` for the "Closed" window and filters on the
   * end day; the page budget is per slice.
   */
  async findDoneByVisitStart(from: string, to: string): Promise<ItemsRead> {
    const slices = daySegments(from, to);
    const reads = await Promise.all(
      slices.map((s) =>
        this.walk(DEALS_GSI5_NAME, 'GSI5PK', 'GSI5SK', `STATUS#${JobSuperStatus.DONE}`, `${s.from}#`, `${s.to}#~~`),
      ),
    );
    return this.merge(reads);
  }

  /**
   * Done jobs CREATED between two instants (ISO, inclusive) — the status
   * index's sort key. The caller turns local days into instants.
   */
  async findDoneByCreated(fromIso: string, toIso: string): Promise<ItemsRead> {
    const slices = daySegments(fromIso.slice(0, 10), toIso.slice(0, 10));
    const reads = await Promise.all(
      slices.map((s, i) =>
        this.walk(
          DEALS_GSI1_NAME,
          'GSI1PK',
          'GSI1SK',
          `STATUS#${JobSuperStatus.DONE}`,
          i === 0 ? fromIso : s.from,
          i === slices.length - 1 ? `${toIso}~` : `${s.to}~`,
        ),
      ),
    );
    return this.merge(reads);
  }

  /**
   * One technician's Done jobs whose visit starts in `[from, to]`: their
   * `ASSIGN#` rows off the tech index, then the deals themselves. A job they
   * are merely on (not primary) comes back too — the service decides.
   */
  async findDoneByTech(techId: string, from: string, to: string): Promise<ItemsRead> {
    const ids: string[] = [];
    let startKey: Record<string, unknown> | undefined;
    let pages = 0;
    let truncated = false;
    do {
      if (pages >= MAX_PAGES_PER_SEGMENT) {
        truncated = true;
        break;
      }
      pages += 1;
      const res = await this.dynamoDb.client.send(
        new QueryCommand({
          TableName: DEALS_TABLE,
          IndexName: DEALS_GSI2_NAME,
          KeyConditionExpression: 'GSI2PK = :pk AND GSI2SK BETWEEN :from AND :to',
          ExpressionAttributeValues: { ':pk': `TECH#${techId}`, ':from': from, ':to': `${to}~` },
          ProjectionExpression: 'dealId',
          ExclusiveStartKey: startKey,
        }),
      );
      for (const row of res.Items ?? []) if (typeof row.dealId === 'string') ids.push(row.dealId);
      startKey = res.LastEvaluatedKey;
    } while (startKey);

    const items = (await this.batchGet([...new Set(ids)])).filter(
      (i) => i.superStatus === JobSuperStatus.DONE && (i.status ?? DealStatus.ACTIVE) === DealStatus.ACTIVE,
    );
    return { items, truncated };
  }

  /** One index partition, a key range, walked to its end (or its page budget). */
  private async walk(
    indexName: string,
    pkAttr: string,
    skAttr: string,
    pk: string,
    from: string,
    to: string,
  ): Promise<ItemsRead> {
    const items: CommissionDealItem[] = [];
    let startKey: Record<string, unknown> | undefined;
    let pages = 0;
    do {
      if (pages >= MAX_PAGES_PER_SEGMENT) {
        this.logger.warn(`${indexName} ${pk} ${from}..${to}: stopped after ${pages} pages`);
        return { items, truncated: true };
      }
      pages += 1;
      const res = await this.dynamoDb.client.send(
        new QueryCommand({
          TableName: DEALS_TABLE,
          IndexName: indexName,
          KeyConditionExpression: '#pk = :pk AND #sk BETWEEN :from AND :to',
          FilterExpression: '#st = :active',
          ProjectionExpression: PROJECTION,
          ExpressionAttributeNames: { ...PROJECTION_NAMES, '#pk': pkAttr, '#sk': skAttr, '#st': 'status' },
          ExpressionAttributeValues: { ':pk': pk, ':from': from, ':to': to, ':active': DealStatus.ACTIVE },
          ExclusiveStartKey: startKey,
        }),
      );
      for (const item of res.Items ?? []) items.push(item as CommissionDealItem);
      startKey = res.LastEvaluatedKey;
    } while (startKey);
    return { items, truncated: false };
  }

  private async batchGet(ids: string[]): Promise<CommissionDealItem[]> {
    const out: CommissionDealItem[] = [];
    for (let i = 0; i < ids.length; i += BATCH_GET_MAX) {
      let keys: Record<string, unknown>[] = ids.slice(i, i + BATCH_GET_MAX).map((id) => ({ PK: `DEAL#${id}`, SK: 'METADATA' }));
      for (let attempt = 0; keys.length && attempt < 5; attempt++) {
        const res = await this.dynamoDb.client.send(
          new BatchGetCommand({
            RequestItems: {
              [DEALS_TABLE]: { Keys: keys, ProjectionExpression: PROJECTION, ExpressionAttributeNames: PROJECTION_NAMES },
            },
          }),
        );
        for (const item of res.Responses?.[DEALS_TABLE] ?? []) out.push(item as CommissionDealItem);
        keys = (res.UnprocessedKeys?.[DEALS_TABLE]?.Keys as Record<string, unknown>[] | undefined) ?? [];
      }
      if (keys.length) this.logger.warn(`BatchGet left ${keys.length} deals unread after retries`);
    }
    return out;
  }

  /** Slices overlap on nothing, but a row can straddle two reads of a retried page: dedupe by id. */
  private merge(reads: ItemsRead[]): ItemsRead {
    const byId = new Map<string, CommissionDealItem>();
    for (const r of reads) for (const item of r.items) byId.set(item.id, item);
    return { items: [...byId.values()], truncated: reads.some((r) => r.truncated) };
  }
}
