import { Injectable, Logger } from '@nestjs/common';
import {
  GetCommand,
  PutCommand,
  DeleteCommand,
  QueryCommand,
  ScanCommand,
  UpdateCommand,
  BatchGetCommand,
} from '@aws-sdk/lib-dynamodb';
import { DynamoDbService, scanPage } from '@bitcrm/shared';
import {
  DealStatus,
  JobSuperStatus,
  STAGE_TO_SUPER_STATUS,
  type Deal,
  type DealStage,
  type SendToTechChannel,
} from '@bitcrm/types';
import {
  DEALS_TABLE,
  DEALS_GSI1_NAME,
  DEALS_GSI2_NAME,
  DEALS_GSI3_NAME,
  DEALS_GSI4_NAME,
  DEALS_GSI5_NAME,
  DEALS_GSI6_NAME,
} from '../common/constants/dynamo.constants';
import { generateDealNumberCode } from './deal-number.util';

export interface PaginatedResult {
  items: Deal[];
  nextCursor?: string;
}

/** A window on the schedule index: a span of visit days, or the undated ones. */
export interface ScheduleWindow {
  /** YYYY-MM-DD, inclusive. */
  from?: string;
  /** YYYY-MM-DD, inclusive. */
  to?: string;
  /** Only deals with no `scheduledDate`. Wins over `from` / `to`. */
  unscheduled?: boolean;
}

export type SortDir = 'asc' | 'desc';

/** A span of days, inclusive, on any ISO-dated sort key. */
export interface DayWindow {
  from?: string;
  to?: string;
}

/** One index read fanned over several partitions (statuses, or months). */
interface IndexRead {
  indexName: string;
  pkAttr: string;
  skAttr: string;
  partitions: { name: string; pk: string }[];
  /** With `#pk` / `#sk` for the attribute names and `:pk` for the partition value. */
  keyCondition: string;
  keyValues: Record<string, unknown>;
}

/** The `YYYY-MM` months a span of days touches, first to last (at most twenty years). */
export function monthsOf(window: DayWindow): string[] {
  const from = (window.from ?? '2015-01-01').slice(0, 7);
  const to = (window.to ?? new Date().toISOString()).slice(0, 7);
  const out: string[] = [];
  let [y, m] = from.split('-').map(Number);
  while (out.length < 240) {
    const key = `${y}-${String(m).padStart(2, '0')}`;
    out.push(key);
    if (key >= to) break;
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out;
}

/** The sort key of an undated deal — 'U' sorts after every digit, so they come last ascending. */
const UNSCHEDULED = 'UNSCHED';

/**
 * The StatusScheduleIndex keys of a deal, plus `slotStart` — the `HH:MM`
 * the visit opens with, kept as its own attribute so an hour-of-day filter
 * is one BETWEEN. An all-day or slotless visit sorts under `~`, after the
 * timed ones of that day. The Workiz importer writes the very same shape.
 */
export function statusScheduleKeys(deal: {
  id: string;
  superStatus: JobSuperStatus;
  scheduledDate?: string;
  scheduledTimeSlot?: string;
  allDay?: boolean;
}): { GSI5PK: string; GSI5SK: string; slotStart: string | undefined } {
  const slotStart = !deal.allDay && deal.scheduledTimeSlot ? deal.scheduledTimeSlot.slice(0, 5) : undefined;
  return {
    GSI5PK: `STATUS#${deal.superStatus}`,
    GSI5SK: `${deal.scheduledDate || UNSCHEDULED}#${slotStart ?? '~'}#DEAL#${deal.id}`,
    slotStart,
  };
}

/**
 * The ClosedIndex keys of a deal — one partition a month of closing, sorted
 * by the closing moment — or nothing at all for an open deal: the index is
 * sparse, so the report's "By: Job closed" reads only what closed.
 */
export function closedIndexKeys(deal: { id: string; closedAt?: string }): { GSI6PK: string; GSI6SK: string } | undefined {
  if (!deal.closedAt) return undefined;
  return { GSI6PK: `CLOSED#${deal.closedAt.slice(0, 7)}`, GSI6SK: `${deal.closedAt}#DEAL#${deal.id}` };
}

/** The deal attributes the date indexes are computed from. */
const INDEX_KEY_FIELDS: ReadonlySet<string> = new Set(['superStatus', 'scheduledDate', 'scheduledTimeSlot', 'allDay', 'closedAt']);

/** Secondary (non-index) filters applied on top of the primary query/scan. */
export interface DealFilters {
  jobTypeId?: string;
  sourceId?: string;
  businessProfileId?: string;
  serviceArea?: string;
  clientType?: string;
  priority?: string;
  tagIds?: string[];
  /** Random 6-char code (string) or legacy sequential id (number, stored as-is). */
  dealNumber?: string | number;
  /** Billing: jobs with at least one line item and no invoice yet. */
  needsInvoice?: boolean;
  /**
   * Only deals this technician is assigned to. On the status / contact /
   * dispatcher indexes it is a `contains(assignedTechIds)` filter; on the
   * tech index it is the key itself and is ignored.
   */
  techId?: string;
  subStatusId?: string;
  /** The client's company (a CRM company id) — the report's "company" filter. */
  companyId?: string;
  /** Who created the job — the report's "creator" filter. */
  createdBy?: string;
  /** On an index not keyed by status (the closed index), the status is a filter. */
  superStatus?: JobSuperStatus;
  /** Hour-of-day window on `slotStart` (`HH:MM`, inclusive). Undated / all-day visits never match. */
  hourFrom?: string;
  hourTo?: string;
}

/**
 * A partial deal patch. A field set to `null` CLEARS (REMOVEs) the stored
 * attribute; `undefined` leaves it untouched. This is how a deal's sub-status
 * is dropped when it moves to a bare super-status.
 */
export type DealUpdate = Partial<{ [K in keyof Deal]: Deal[K] | null }>;

/** What messaging-service reported for one (technician, channel) of a send. */
export interface SentToTechDelivery {
  status: 'sent' | 'skipped' | 'failed';
  /** The click this delivery belongs to (the deal's `sentToTechAt` at that time). */
  sentAt: string;
  at: string;
  reason?: string;
  messageId?: string;
  conversationId?: string;
}

/**
 * The `ASSIGN#<techId>` adjacency row as the service reads it — the roster
 * membership, the Workiz per-technician "sent" / "seen" stamps, and the
 * technician flow's own receipt confirmation.
 */
export interface DealAssignment {
  dealId: string;
  techId: string;
  assignedBy?: string;
  assignedAt?: string;
  scheduledDate?: string;
  /** The latest "Send to tech" click that included this technician. */
  sentAt?: string;
  sentVia?: SendToTechChannel[];
  sentBy?: string;
  /** First time this technician opened the job in their app (sticky). */
  seenAt?: string;
  /**
   * Technician flow ("Confirmed job receipt"). Per-technician: on a two-tech
   * job each one confirms their own receipt.
   */
  techConfirmedAt?: string;
  /** Per-channel outcome of the latest send, written back by messaging-service. */
  deliveries?: Partial<Record<SendToTechChannel, SentToTechDelivery>>;
}

@Injectable()
export class DealsRepository {
  private readonly logger = new Logger(DealsRepository.name);
  private tableName = DEALS_TABLE;

  constructor(private readonly dynamoDb: DynamoDbService) {}

  /**
   * Builds the `#status = :active [AND ...]` FilterExpression shared by the
   * index-backed list queries, appending equality filters and tag `contains`
   * checks. All attribute names are aliased to dodge DynamoDB reserved words.
   */
  private dealFilterExpression(
    filters?: DealFilters,
    statusValue: string = DealStatus.ACTIVE,
  ): {
    expression: string;
    names: Record<string, string>;
    values: Record<string, unknown>;
  } {
    const parts = ['#status = :active'];
    const names: Record<string, string> = { '#status': 'status' };
    const values: Record<string, unknown> = { ':active': statusValue };
    const eq = (attr: string, val: unknown) => {
      parts.push(`#${attr} = :${attr}`);
      names[`#${attr}`] = attr;
      values[`:${attr}`] = val;
    };
    if (filters?.jobTypeId) eq('jobTypeId', filters.jobTypeId);
    if (filters?.sourceId) eq('sourceId', filters.sourceId);
    if (filters?.businessProfileId) eq('businessProfileId', filters.businessProfileId);
    if (filters?.serviceArea) eq('serviceArea', filters.serviceArea);
    if (filters?.clientType) eq('clientType', filters.clientType);
    if (filters?.priority) eq('priority', filters.priority);
    if (filters?.dealNumber !== undefined) eq('dealNumber', filters.dealNumber);
    if (filters?.needsInvoice) {
      // Legacy rows without `itemCount` don't match until the backfill runs.
      parts.push('#itemCount > :zeroItems', 'attribute_not_exists(#invoiceId)');
      names['#itemCount'] = 'itemCount';
      names['#invoiceId'] = 'invoiceId';
      values[':zeroItems'] = 0;
    }
    if (filters?.tagIds?.length) {
      names['#tagIds'] = 'tagIds';
      filters.tagIds.forEach((t, i) => {
        parts.push(`contains(#tagIds, :tag${i})`);
        values[`:tag${i}`] = t;
      });
    }
    // The technician narrows any index that is not already keyed by them —
    // this is how `assigned_only` holds on the status / contact / dispatcher
    // queries instead of only on the tech index.
    if (filters?.techId) {
      parts.push('contains(#assignedTechIds, :techId)');
      names['#assignedTechIds'] = 'assignedTechIds';
      values[':techId'] = filters.techId;
    }
    if (filters?.subStatusId) eq('subStatusId', filters.subStatusId);
    if (filters?.superStatus) eq('superStatus', filters.superStatus);
    if (filters?.companyId) eq('companyId', filters.companyId);
    if (filters?.createdBy) eq('createdBy', filters.createdBy);
    if (filters?.hourFrom || filters?.hourTo) {
      names['#slotStart'] = 'slotStart';
      values[':hourFrom'] = filters.hourFrom ?? '00:00';
      values[':hourTo'] = filters.hourTo ?? '23:59';
      parts.push('#slotStart BETWEEN :hourFrom AND :hourTo');
    }
    return { expression: parts.join(' AND '), names, values };
  }

  /**
   * In-memory equivalent of `dealFilterExpression`, used after a BatchGet where
   * the filter can't run in the query (findByTech resolves deals from
   * assignment rows, then filters the fetched metadata).
   */
  private matchesFilters(deal: Deal, filters?: DealFilters, status: string = DealStatus.ACTIVE): boolean {
    if (deal.status !== status) return false;
    if (filters?.jobTypeId && deal.jobTypeId !== filters.jobTypeId) return false;
    if (filters?.sourceId && deal.sourceId !== filters.sourceId) return false;
    if (filters?.businessProfileId && deal.businessProfileId !== filters.businessProfileId) return false;
    if (filters?.serviceArea && deal.serviceArea !== filters.serviceArea) return false;
    if (filters?.clientType && deal.clientType !== filters.clientType) return false;
    if (filters?.priority && deal.priority !== filters.priority) return false;
    if (filters?.dealNumber !== undefined && String(deal.dealNumber) !== String(filters.dealNumber)) return false;
    if (filters?.tagIds?.length && !filters.tagIds.every((t) => deal.tagIds.includes(t))) return false;
    if (filters?.needsInvoice && (!(deal.itemCount && deal.itemCount > 0) || deal.invoiceId)) return false;
    if (filters?.techId && !deal.assignedTechIds.includes(filters.techId)) return false;
    if (filters?.subStatusId && deal.subStatusId !== filters.subStatusId) return false;
    if (filters?.superStatus && deal.superStatus !== filters.superStatus) return false;
    if (filters?.companyId && deal.companyId !== filters.companyId) return false;
    if (filters?.createdBy && deal.createdBy !== filters.createdBy) return false;
    if (filters?.hourFrom || filters?.hourTo) {
      const { slotStart } = statusScheduleKeys(deal);
      if (!slotStart) return false;
      if (slotStart < (filters.hourFrom ?? '00:00') || slotStart > (filters.hourTo ?? '23:59')) return false;
    }
    return true;
  }

  async create(deal: Deal): Promise<void> {
    await this.dynamoDb.client.send(
      new PutCommand({
        TableName: this.tableName,
        // No GSI2 on metadata: the tech index is owned by ASSIGN#<techId> rows.
        Item: {
          PK: `DEAL#${deal.id}`,
          SK: 'METADATA',
          GSI1PK: `STATUS#${deal.superStatus}`,
          GSI1SK: `${deal.createdAt}#DEAL#${deal.id}`,
          GSI3PK: `CONTACT#${deal.contactId}`,
          GSI3SK: `${deal.createdAt}#DEAL#${deal.id}`,
          GSI4PK: `DISPATCHER#${deal.assignedDispatcherId}`,
          GSI4SK: `${deal.createdAt}#DEAL#${deal.id}`,
          ...statusScheduleKeys(deal),
          ...closedIndexKeys(deal),
          ...deal,
        },
        ConditionExpression: 'attribute_not_exists(PK)',
      }),
    );
  }

  async findById(id: string): Promise<Deal | null> {
    const result = await this.dynamoDb.client.send(
      new GetCommand({
        TableName: this.tableName,
        Key: { PK: `DEAL#${id}`, SK: 'METADATA' },
      }),
    );

    if (!result.Item) return null;
    return this.toDeal(result.Item);
  }

  async findBySuperStatus(
    superStatus: string,
    limit: number,
    cursor?: string,
    filters?: DealFilters,
  ): Promise<PaginatedResult> {
    const f = this.dealFilterExpression(filters);
    const result = await this.dynamoDb.client.send(
      new QueryCommand({
        TableName: this.tableName,
        IndexName: DEALS_GSI1_NAME,
        KeyConditionExpression: 'GSI1PK = :pk',
        FilterExpression: f.expression,
        ExpressionAttributeValues: { ':pk': `STATUS#${superStatus}`, ...f.values },
        ExpressionAttributeNames: f.names,
        ScanIndexForward: false,
        Limit: limit,
        ExclusiveStartKey: this.decodeCursor(cursor),
      }),
    );

    return {
      items: (result.Items || []).map((i) => this.toDeal(i)),
      nextCursor: this.encodeCursor(result.LastEvaluatedKey),
    };
  }

  /**
   * Deals in visit-date order, from the StatusScheduleIndex: one status is
   * one query; several statuses are one query each, merged in key order
   * with a per-partition cursor (`fanOut`).
   */
  async findBySchedule(
    superStatuses: JobSuperStatus[],
    window: ScheduleWindow,
    limit: number,
    cursor?: string,
    filters?: DealFilters,
    dir: SortDir = 'asc',
  ): Promise<PaginatedResult> {
    const key = this.scheduleKeyCondition(window);
    return this.fanOut(
      {
        indexName: DEALS_GSI5_NAME,
        pkAttr: 'GSI5PK',
        skAttr: 'GSI5SK',
        partitions: superStatuses.map((s) => ({ name: s, pk: `STATUS#${s}` })),
        keyCondition: key.expression,
        keyValues: key.values,
      },
      limit,
      cursor,
      filters,
      dir,
    );
  }

  /**
   * Deals in creation order within a span of days — the status index's own
   * sort key (`<createdAt>#DEAL#<id>`), one status a partition, merged.
   */
  async findByCreated(
    superStatuses: JobSuperStatus[],
    window: DayWindow,
    limit: number,
    cursor?: string,
    filters?: DealFilters,
    dir: SortDir = 'desc',
  ): Promise<PaginatedResult> {
    return this.fanOut(
      {
        indexName: DEALS_GSI1_NAME,
        pkAttr: 'GSI1PK',
        skAttr: 'GSI1SK',
        partitions: superStatuses.map((s) => ({ name: s, pk: `STATUS#${s}` })),
        keyCondition: '#pk = :pk AND #sk BETWEEN :from AND :to',
        keyValues: this.dayRangeValues(window),
      },
      limit,
      cursor,
      filters,
      dir,
    );
  }

  /**
   * Deals in closing order within a span of days, off the sparse ClosedIndex
   * — one partition a month, so a window is one query per month it touches,
   * merged on the closing moment. A status here is a filter, not a key.
   */
  async findByClosed(
    window: DayWindow,
    limit: number,
    cursor?: string,
    filters?: DealFilters,
    dir: SortDir = 'desc',
  ): Promise<PaginatedResult> {
    return this.fanOut(
      {
        indexName: DEALS_GSI6_NAME,
        pkAttr: 'GSI6PK',
        skAttr: 'GSI6SK',
        partitions: monthsOf(window).map((m) => ({ name: m, pk: `CLOSED#${m}` })),
        keyCondition: '#pk = :pk AND #sk BETWEEN :from AND :to',
        keyValues: this.dayRangeValues(window),
      },
      limit,
      cursor,
      filters,
      dir,
    );
  }

  /**
   * How many deals of one status fall in a schedule window, with the same
   * filters the list applies — a `Select: COUNT` walked to the end of the
   * range. It reads every row of the range, so the caller keeps the range
   * bounded (a closed status without a window is never counted).
   */
  /** `cap` — стеля: набравши стільки, лічильник спиняється, і число означає «не менше». */
  countBySchedule(
    superStatus: JobSuperStatus,
    window: ScheduleWindow,
    filters?: DealFilters,
    cap?: number,
  ): Promise<number> {
    const key = this.scheduleKeyCondition(window);
    return this.countOn(DEALS_GSI5_NAME, 'GSI5PK', 'GSI5SK', [`STATUS#${superStatus}`], key.expression, key.values, filters, cap);
  }

  /** How many deals of one status were created in a span of days, under the list's filters. */
  countByCreated(superStatus: JobSuperStatus, window: DayWindow, filters?: DealFilters): Promise<number> {
    return this.countOn(
      DEALS_GSI1_NAME,
      'GSI1PK',
      'GSI1SK',
      [`STATUS#${superStatus}`],
      '#pk = :pk AND #sk BETWEEN :from AND :to',
      this.dayRangeValues(window),
      filters,
    );
  }

  /** How many deals closed in a span of days, under the list's filters (a status is one of them). */
  countByClosed(window: DayWindow, filters?: DealFilters): Promise<number> {
    return this.countOn(
      DEALS_GSI6_NAME,
      'GSI6PK',
      'GSI6SK',
      monthsOf(window).map((m) => `CLOSED#${m}`),
      '#pk = :pk AND #sk BETWEEN :from AND :to',
      this.dayRangeValues(window),
      filters,
    );
  }

  /** The key condition of a schedule window: a day span, the undated ones, or the whole partition. */
  private scheduleKeyCondition(window: ScheduleWindow): { expression: string; values: Record<string, unknown> } {
    if (window.unscheduled) {
      return { expression: '#pk = :pk AND begins_with(#sk, :unsched)', values: { ':unsched': `${UNSCHEDULED}#` } };
    }
    if (window.from || window.to) {
      // '#~~' sits above both a timed ('#09:00#…') and an all-day ('#~#…') row of that day.
      return {
        expression: '#pk = :pk AND #sk BETWEEN :from AND :to',
        values: { ':from': `${window.from ?? '0000-00-00'}#`, ':to': `${window.to ?? '9999-12-31'}#~~` },
      };
    }
    return { expression: '#pk = :pk', values: {} };
  }

  /** `<from>` … `<to>~` — a span of days as a range on an ISO-dated sort key. */
  private dayRangeValues(window: DayWindow): Record<string, unknown> {
    return { ':from': window.from ?? '0000-00-00', ':to': `${window.to ?? '9999-12-31'}~` };
  }

  /**
   * One query per partition, merged in sort-key order, with a
   * `{partition: lastKey}` cursor (base64url) so every partition resumes
   * exactly after its last consumed row. Each partition is asked for a full
   * page and only the merged head is kept — a few rows over the fetch,
   * never a partition read past what the page needs.
   */
  private async fanOut(
    read: IndexRead,
    limit: number,
    cursor: string | undefined,
    filters: DealFilters | undefined,
    dir: SortDir,
  ): Promise<PaginatedResult> {
    const f = this.dealFilterExpression(filters);
    const names = read.partitions.map((p) => p.name);
    const cursors = this.decodePartitionCursors(cursor, names);

    const pages = await Promise.all(
      read.partitions.map(async (partition) => {
        // 'done' marks a partition already read to its end on an earlier page.
        if (cursors[partition.name] === 'done') {
          return {
            name: partition.name,
            items: [] as Record<string, unknown>[],
            lastEvaluatedKey: undefined as Record<string, unknown> | undefined,
          };
        }
        const result = await this.dynamoDb.client.send(
          new QueryCommand({
            TableName: this.tableName,
            IndexName: read.indexName,
            KeyConditionExpression: read.keyCondition,
            FilterExpression: f.expression,
            ExpressionAttributeNames: this.expressionNames(read.keyCondition, f.names, read.pkAttr, read.skAttr),
            ExpressionAttributeValues: { ':pk': partition.pk, ...read.keyValues, ...f.values },
            ScanIndexForward: dir === 'asc',
            Limit: limit,
            ExclusiveStartKey: cursors[partition.name] as Record<string, unknown> | undefined,
          }),
        );
        return { name: partition.name, items: result.Items ?? [], lastEvaluatedKey: result.LastEvaluatedKey };
      }),
    );

    if (pages.length === 1) {
      const [page] = pages;
      return {
        items: page.items.map((i) => this.toDeal(i)),
        nextCursor: page.lastEvaluatedKey ? this.encodePartitionCursors({ [page.name]: page.lastEvaluatedKey }) : undefined,
      };
    }

    // k-way merge on the sort key; each partition keeps its own position.
    const heads = pages.map((p) => ({ ...p, pos: 0 }));
    const taken: Record<string, unknown>[] = [];
    const before = (a: string, b: string) => (dir === 'asc' ? a < b : a > b);
    while (taken.length < limit) {
      let best: (typeof heads)[number] | undefined;
      for (const h of heads) {
        if (h.pos >= h.items.length) continue;
        if (!best || before(h.items[h.pos][read.skAttr] as string, best.items[best.pos][read.skAttr] as string)) best = h;
      }
      if (!best) break;
      taken.push(best.items[best.pos]);
      best.pos += 1;
    }

    const next: Record<string, unknown> = {};
    let anyLeft = false;
    for (const h of heads) {
      if (h.pos >= h.items.length) {
        // Everything fetched was consumed (or nothing came back): resume where
        // DynamoDB stopped — which also steps past a page the filter emptied —
        // or close the partition when it read to its end.
        if (!h.lastEvaluatedKey) {
          next[h.name] = 'done';
          continue;
        }
        next[h.name] = h.lastEvaluatedKey;
      } else {
        // Part of the fetch made the page: resume right after the last consumed
        // row, or from the same start when none of this partition was taken.
        next[h.name] = h.pos > 0 ? this.indexKeyOf(h.items[h.pos - 1], read) : (cursors[h.name] ?? null);
      }
      anyLeft = true;
    }
    return {
      items: taken.map((i) => this.toDeal(i)),
      nextCursor: anyLeft ? this.encodePartitionCursors(next) : undefined,
    };
  }

  /**
   * The names an index read declares. DynamoDB rejects the whole request
   * when `ExpressionAttributeNames` holds a name no expression uses, and a
   * key condition without a range (the jobs list with no date window) never
   * mentions `#sk`.
   */
  private expressionNames(
    keyCondition: string,
    filterNames: Record<string, string>,
    pkAttr: string,
    skAttr: string,
  ): Record<string, string> {
    return {
      ...filterNames,
      '#pk': pkAttr,
      ...(keyCondition.includes('#sk') ? { '#sk': skAttr } : {}),
    };
  }

  /** A `Select: COUNT` over every partition of a read, each walked to the end of its range. */
  private async countOn(
    indexName: string,
    pkAttr: string,
    skAttr: string,
    partitionKeys: string[],
    keyCondition: string,
    keyValues: Record<string, unknown>,
    filters?: DealFilters,
    cap?: number,
  ): Promise<number> {
    const f = this.dealFilterExpression(filters);
    const counts = await Promise.all(
      partitionKeys.map(async (pk) => {
        let count = 0;
        let lastKey: Record<string, unknown> | undefined;
        do {
          const result = await this.dynamoDb.client.send(
            new QueryCommand({
              TableName: this.tableName,
              IndexName: indexName,
              KeyConditionExpression: keyCondition,
              FilterExpression: f.expression,
              ExpressionAttributeNames: this.expressionNames(keyCondition, f.names, pkAttr, skAttr),
              ExpressionAttributeValues: { ':pk': pk, ...keyValues, ...f.values },
              Select: 'COUNT',
              ExclusiveStartKey: lastKey,
            }),
          );
          count += result.Count ?? 0;
          lastKey = result.LastEvaluatedKey;
          // Стеля перетнута — далі гортати нема сенсу: відповідь уже «не менше».
          if (cap !== undefined && count >= cap) break;
        } while (lastKey);
        return count;
      }),
    );
    return counts.reduce((a, b) => a + b, 0);
  }

  /** The ExclusiveStartKey an index row resumes from: table keys plus that index's keys. */
  private indexKeyOf(item: Record<string, unknown>, read: IndexRead): Record<string, unknown> {
    return { PK: item.PK, SK: item.SK, [read.pkAttr]: item[read.pkAttr], [read.skAttr]: item[read.skAttr] };
  }

  private encodePartitionCursors(cursors: Record<string, unknown>): string {
    return Buffer.from(JSON.stringify(cursors)).toString('base64url');
  }

  /**
   * A per-partition cursor map; a plain single-partition cursor (a raw
   * DynamoDB key) is also accepted for a one-partition read. A `null` entry
   * means "from the start".
   */
  private decodePartitionCursors(cursor: string | undefined, names: string[]): Record<string, unknown> {
    const decoded = this.decodeCursor(cursor);
    if (!decoded) return {};
    if ('PK' in decoded && names.length === 1) return { [names[0]]: decoded };
    const out: Record<string, unknown> = {};
    for (const n of names) if (decoded[n] != null) out[n] = decoded[n];
    return out;
  }

  /**
   * A technician's deals — every deal they're assigned to. Queries the tech
   * index for the technician's `ASSIGN#` rows, then batch-gets the deal
   * metadata. Filters run in memory since they target deal attributes, not the
   * assignment rows.
   */
  async findByTech(
    techId: string,
    limit: number,
    cursor?: string,
    filters?: DealFilters,
    window?: Pick<ScheduleWindow, 'from' | 'to'>,
    dir: SortDir = 'desc',
  ): Promise<PaginatedResult> {
    // GSI2SK is `<scheduledDate>#DEAL#<id>` (an ISO stamp for an undated
    // assignment), so a span of days is a plain key range; '~' sits above
    // any suffix of the last day.
    const bounded = Boolean(window?.from || window?.to);
    const result = await this.dynamoDb.client.send(
      new QueryCommand({
        TableName: this.tableName,
        IndexName: DEALS_GSI2_NAME,
        KeyConditionExpression: bounded ? 'GSI2PK = :pk AND GSI2SK BETWEEN :from AND :to' : 'GSI2PK = :pk',
        ExpressionAttributeValues: {
          ':pk': `TECH#${techId}`,
          ...(bounded ? { ':from': window?.from ?? '0000-00-00', ':to': `${window?.to ?? '9999-12-31'}~` } : {}),
        },
        ScanIndexForward: dir === 'asc',
        Limit: limit,
        ExclusiveStartKey: this.decodeCursor(cursor),
      }),
    );

    const dealIds = (result.Items || []).map((i) => i.dealId as string);
    const deals = await this.batchGetDeals(dealIds);
    return {
      items: deals.filter((d) => this.matchesFilters(d, filters)),
      nextCursor: this.encodeCursor(result.LastEvaluatedKey),
    };
  }

  async findByContact(
    contactId: string,
    limit: number,
    cursor?: string,
    filters?: DealFilters,
  ): Promise<PaginatedResult> {
    const f = this.dealFilterExpression(filters);
    const result = await this.dynamoDb.client.send(
      new QueryCommand({
        TableName: this.tableName,
        IndexName: DEALS_GSI3_NAME,
        KeyConditionExpression: 'GSI3PK = :pk',
        FilterExpression: f.expression,
        ExpressionAttributeValues: { ':pk': `CONTACT#${contactId}`, ...f.values },
        ExpressionAttributeNames: f.names,
        ScanIndexForward: false,
        Limit: limit,
        ExclusiveStartKey: this.decodeCursor(cursor),
      }),
    );

    return {
      items: (result.Items || []).map((i) => this.toDeal(i)),
      nextCursor: this.encodeCursor(result.LastEvaluatedKey),
    };
  }

  async findByDispatcher(
    dispatcherId: string,
    limit: number,
    cursor?: string,
    filters?: DealFilters,
  ): Promise<PaginatedResult> {
    const f = this.dealFilterExpression(filters);
    const result = await this.dynamoDb.client.send(
      new QueryCommand({
        TableName: this.tableName,
        IndexName: DEALS_GSI4_NAME,
        KeyConditionExpression: 'GSI4PK = :pk',
        FilterExpression: f.expression,
        ExpressionAttributeValues: { ':pk': `DISPATCHER#${dispatcherId}`, ...f.values },
        ExpressionAttributeNames: f.names,
        ScanIndexForward: false,
        Limit: limit,
        ExclusiveStartKey: this.decodeCursor(cursor),
      }),
    );

    return {
      items: (result.Items || []).map((i) => this.toDeal(i)),
      nextCursor: this.encodeCursor(result.LastEvaluatedKey),
    };
  }

  async findAll(
    limit: number,
    cursor?: string,
    filters?: DealFilters & { status?: string },
  ): Promise<PaginatedResult> {
    const f = this.dealFilterExpression(filters, filters?.status || DealStatus.ACTIVE);

    // Only a fraction of this table is jobs: a job's own partition also holds
    // its line items, assignments and history, and every catalog lives here
    // besides. DynamoDB caps `Limit` on rows READ and filters afterwards, so
    // asking for 50 came back with one job. `scanPage` fills the page.
    const page = await scanPage<Record<string, unknown>>(
      (input) =>
        this.dynamoDb.client.send(
          new ScanCommand({
            TableName: this.tableName,
            FilterExpression: `begins_with(PK, :pk) AND SK = :sk AND ${f.expression}`,
            ExpressionAttributeValues: { ':pk': 'DEAL#', ':sk': 'METADATA', ...f.values },
            ExpressionAttributeNames: f.names,
            ...input,
          }),
        ),
      limit,
      { startKey: this.decodeCursor(cursor), keyOf: (i) => ({ PK: i.PK, SK: i.SK }) },
    );

    return {
      items: page.items.map((i) => this.toDeal(i)),
      nextCursor: this.encodeCursor(page.lastKey),
    };
  }

  // ------------------------------------------------------------- assignments

  /**
   * Assignment adjacency row: PK=DEAL#<id>, SK=ASSIGN#<techId>, indexed on the
   * tech GSI so `findByTech` returns every deal a technician is on. Idempotent —
   * re-adding the same tech overwrites the row (refreshes the sort key).
   */
  async addAssignment(
    dealId: string,
    techId: string,
    scheduledDate: string | undefined,
    by: string,
  ): Promise<void> {
    await this.dynamoDb.client.send(
      new PutCommand({
        TableName: this.tableName,
        Item: {
          PK: `DEAL#${dealId}`,
          SK: `ASSIGN#${techId}`,
          GSI2PK: `TECH#${techId}`,
          GSI2SK: `${scheduledDate || new Date().toISOString()}#DEAL#${dealId}`,
          dealId,
          techId,
          assignedBy: by,
          assignedAt: new Date().toISOString(),
          scheduledDate,
        },
      }),
    );
  }

  async removeAssignment(dealId: string, techId: string): Promise<void> {
    await this.dynamoDb.client.send(
      new DeleteCommand({
        TableName: this.tableName,
        Key: { PK: `DEAL#${dealId}`, SK: `ASSIGN#${techId}` },
      }),
    );
  }

  /** The technician ids currently assigned to a deal (from its assignment rows). */
  async listAssignmentTechIds(dealId: string): Promise<string[]> {
    const result = await this.dynamoDb.client.send(
      new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
        ExpressionAttributeValues: { ':pk': `DEAL#${dealId}`, ':sk': 'ASSIGN#' },
      }),
    );
    return (result.Items || []).map((i) => i.techId as string);
  }

  /**
   * Re-stamp every assignment row's tech-index keys when a deal's date
   * changes. An in-place UPDATE, not a re-Put: the rows also carry the
   * technician's "sent" / "seen" stamps and their `techConfirmedAt`, and
   * moving the job to next Tuesday must erase none of them. The original
   * `assignedBy` / `assignedAt` stay; `by` is recorded as `restampedBy`.
   *
   * `GSI2PK` is written next to `GSI2SK` even though it never changes: the
   * re-Put this replaced also rewrote it, so a row that lost it (or an
   * imported one that never had it) was healed by any reschedule and stayed
   * visible to `findByTech` / the dispatch board. Keeping that repair is the
   * whole reason the SET clause is wider than it needs to be.
   */
  async restampAssignmentDates(dealId: string, scheduledDate: string | undefined, by: string): Promise<void> {
    const techIds = await this.listAssignmentTechIds(dealId);
    await Promise.all(
      techIds.map((techId) =>
        this.writeAssignmentIfPresent(
          new UpdateCommand({
            TableName: this.tableName,
            Key: { PK: `DEAL#${dealId}`, SK: `ASSIGN#${techId}` },
            UpdateExpression: scheduledDate
              ? 'SET GSI2PK = :gsi2pk, GSI2SK = :gsi2sk, scheduledDate = :scheduledDate, restampedBy = :by, restampedAt = :now'
              : 'SET GSI2PK = :gsi2pk, GSI2SK = :gsi2sk, restampedBy = :by, restampedAt = :now REMOVE scheduledDate',
            ExpressionAttributeValues: {
              ':gsi2pk': `TECH#${techId}`,
              ':gsi2sk': `${scheduledDate || new Date().toISOString()}#DEAL#${dealId}`,
              ':by': by,
              ':now': new Date().toISOString(),
              ...(scheduledDate ? { ':scheduledDate': scheduledDate } : {}),
            },
            ConditionExpression: 'attribute_exists(PK)',
          }),
          `date restamp of ${dealId}/${techId}`,
        ),
      ),
    );
  }

  /**
   * An `ASSIGN#` write guarded by `attribute_exists(PK)`. The row vanishing
   * under us — a concurrent unassign between the roster read and this write —
   * is an expected race, not a failure: the row that is gone is exactly the
   * one that no longer needs the write, and the unconditional Put this
   * replaced would simply have succeeded. Logged and reported as "not
   * written"; every other error rethrows.
   */
  private async writeAssignmentIfPresent(command: UpdateCommand, what: string): Promise<boolean> {
    try {
      await this.dynamoDb.client.send(command);
      return true;
    } catch (error) {
      if ((error as Error).name !== 'ConditionalCheckFailedException') throw error;
      this.logger.warn(`Skipped the ${what}: the assignment row is no longer there`);
      return false;
    }
  }

  // --------------------------------------- assignments: sent / seen / confirmed

  /**
   * One technician's `ASSIGN#` row, or null when they are not on the deal —
   * the roster membership, the Workiz "sent" / "seen" stamps and the
   * technician flow's own `techConfirmedAt`.
   */
  async getAssignment(dealId: string, techId: string): Promise<DealAssignment | null> {
    const result = await this.dynamoDb.client.send(
      new GetCommand({
        TableName: this.tableName,
        Key: { PK: `DEAL#${dealId}`, SK: `ASSIGN#${techId}` },
      }),
    );
    return result.Item ? this.toAssignment(result.Item) : null;
  }

  /** Every `ASSIGN#` row of a deal, with its sent / seen stamps. */
  async listAssignments(dealId: string): Promise<DealAssignment[]> {
    const result = await this.dynamoDb.client.send(
      new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
        ExpressionAttributeValues: { ':pk': `DEAL#${dealId}`, ':sk': 'ASSIGN#' },
      }),
    );
    return (result.Items || []).map((i) => this.toAssignment(i));
  }

  /**
   * Stamp "this technician has seen the job" on their own assignment row —
   * per-technician by nature, so it belongs here and not on the shared deal
   * metadata (which carries the first confirmation as a convenience mirror).
   *
   * `if_not_exists` keeps the FIRST tap: a second one is a no-op rather than a
   * later timestamp, and the guard makes it safe to call twice. The row must
   * already exist (the technician must be assigned), so an unassigned caller
   * fails the condition instead of creating a phantom assignment.
   *
   * Answers with the stamp the row carried BEFORE this write (`ALL_OLD`), so a
   * repeat tap — or the loser of two simultaneous ones — can be told the
   * confirmation was already there and skip the timeline entry and the event
   * it would otherwise write a second time. `undefined` means this call is the
   * one that confirmed the job.
   */
  async confirmAssignment(dealId: string, techId: string, at: string): Promise<string | undefined> {
    const result = await this.dynamoDb.client.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: { PK: `DEAL#${dealId}`, SK: `ASSIGN#${techId}` },
        UpdateExpression: 'SET techConfirmedAt = if_not_exists(techConfirmedAt, :at)',
        ExpressionAttributeValues: { ':at': at },
        ConditionExpression: 'attribute_exists(PK)',
        ReturnValues: 'ALL_OLD',
      }),
    );
    return result?.Attributes?.techConfirmedAt as string | undefined;
  }

  /**
   * Stamp "Send to tech" on each named technician's row (Workiz `last_sent`
   * per tech). The previous send's per-channel `deliveries` are dropped —
   * they described the old click. Only existing rows are touched, and a
   * technician on the roster whose row is missing (a concurrent unassign, a
   * job the assignment backfill never reached) is skipped rather than
   * aborting the send for everyone else. Answers which rows were stamped.
   */
  async markAssignmentsSent(
    dealId: string,
    techIds: string[],
    stamp: { sentAt: string; sentVia: SendToTechChannel[]; sentBy: string },
  ): Promise<string[]> {
    const written = await Promise.all(
      techIds.map(async (techId) => {
        const ok = await this.writeAssignmentIfPresent(
          new UpdateCommand({
            TableName: this.tableName,
            Key: { PK: `DEAL#${dealId}`, SK: `ASSIGN#${techId}` },
            UpdateExpression: 'SET sentAt = :sentAt, sentVia = :sentVia, sentBy = :sentBy REMOVE deliveries',
            ExpressionAttributeValues: {
              ':sentAt': stamp.sentAt,
              ':sentVia': stamp.sentVia,
              ':sentBy': stamp.sentBy,
            },
            ConditionExpression: 'attribute_exists(PK)',
          }),
          `sent stamp of ${dealId}/${techId}`,
        );
        return ok ? techId : null;
      }),
    );
    return written.filter((techId): techId is string => techId !== null);
  }

  /**
   * First-open stamp (Workiz `seen`): `if_not_exists` keeps the earliest
   * time, so repeated opens are harmless. Returns the stored value — equal
   * to `seenAt` exactly when this call was the first.
   */
  async markAssignmentSeen(dealId: string, techId: string, seenAt: string): Promise<string> {
    const result = await this.dynamoDb.client.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: { PK: `DEAL#${dealId}`, SK: `ASSIGN#${techId}` },
        UpdateExpression: 'SET seenAt = if_not_exists(seenAt, :seenAt)',
        ExpressionAttributeValues: { ':seenAt': seenAt },
        ConditionExpression: 'attribute_exists(PK)',
        ReturnValues: 'ALL_NEW',
      }),
    );
    return (result.Attributes?.seenAt as string | undefined) ?? seenAt;
  }

  /**
   * Messaging's report for one channel of the latest send. `deliveries` is a
   * map keyed by channel; DynamoDB cannot SET into a missing map, so the
   * map is created empty first (a no-op when it already exists).
   */
  async recordAssignmentDelivery(
    dealId: string,
    techId: string,
    channel: SendToTechChannel,
    delivery: SentToTechDelivery,
  ): Promise<void> {
    const key = { PK: `DEAL#${dealId}`, SK: `ASSIGN#${techId}` };
    await this.dynamoDb.client.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: key,
        UpdateExpression: 'SET deliveries = if_not_exists(deliveries, :empty)',
        ExpressionAttributeValues: { ':empty': {} },
        ConditionExpression: 'attribute_exists(PK)',
      }),
    );
    await this.dynamoDb.client.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: key,
        UpdateExpression: 'SET deliveries.#channel = :delivery',
        ExpressionAttributeNames: { '#channel': channel },
        ExpressionAttributeValues: { ':delivery': delivery },
        ConditionExpression: 'attribute_exists(PK)',
      }),
    );
  }

  private toAssignment(item: Record<string, unknown>): DealAssignment {
    return {
      dealId: item.dealId as string,
      techId: item.techId as string,
      assignedBy: item.assignedBy as string | undefined,
      assignedAt: item.assignedAt as string | undefined,
      scheduledDate: item.scheduledDate as string | undefined,
      sentAt: item.sentAt as string | undefined,
      sentVia: item.sentVia as SendToTechChannel[] | undefined,
      sentBy: item.sentBy as string | undefined,
      seenAt: item.seenAt as string | undefined,
      techConfirmedAt: item.techConfirmedAt as string | undefined,
      deliveries: item.deliveries as DealAssignment['deliveries'],
    };
  }

  /** The deals of a set of ids, in the order asked; missing ones are absent. */
  async findByIds(ids: string[]): Promise<Deal[]> {
    return this.batchGetDeals(ids);
  }

  private async batchGetDeals(ids: string[]): Promise<Deal[]> {
    if (!ids.length) return [];
    const deals: Deal[] = [];
    for (let i = 0; i < ids.length; i += 100) {
      const chunk = ids.slice(i, i + 100);
      const res = await this.dynamoDb.client.send(
        new BatchGetCommand({
          RequestItems: {
            [this.tableName]: {
              Keys: chunk.map((id) => ({ PK: `DEAL#${id}`, SK: 'METADATA' })),
            },
          },
        }),
      );
      for (const item of res.Responses?.[this.tableName] ?? []) deals.push(this.toDeal(item));
    }
    // Preserve the tech-index order the caller asked for.
    const byId = new Map(deals.map((d) => [d.id, d]));
    return ids.map((id) => byId.get(id)).filter((d): d is Deal => Boolean(d));
  }

  async update(id: string, attrs: DealUpdate): Promise<Deal> {
    const setParts: string[] = [];
    const removeParts: string[] = [];
    const expressionNames: Record<string, string> = {};
    const expressionValues: Record<string, unknown> = {};

    const now = new Date().toISOString();
    const updates: Record<string, unknown> = { ...attrs, updatedAt: now };

    // Update GSI keys when relevant fields change. The tech index lives on the
    // assignment rows now, so metadata only owns the super-status index here.
    if (attrs.superStatus !== undefined && attrs.superStatus !== null) {
      updates['GSI1PK'] = `STATUS#${attrs.superStatus}`;
    }

    const immutableKeys = new Set([
      'id', 'dealNumber', 'contactId', 'createdBy', 'createdAt',
    ]);

    for (const [key, value] of Object.entries(updates)) {
      if (immutableKeys.has(key)) continue;
      const attrName = `#${key}`;
      // `null` clears the attribute: SET-to-null would leave it present (and a
      // falsy value), so an explicit null must REMOVE it — that's how a
      // sub-status is dropped when a deal moves to a bare super-status.
      if (value === null) {
        expressionNames[attrName] = key;
        removeParts.push(attrName);
        continue;
      }
      if (value === undefined) continue;
      const attrValue = `:${key}`;
      expressionNames[attrName] = key;
      expressionValues[attrValue] = value;
      setParts.push(`${attrName} = ${attrValue}`);
    }

    // updatedAt is always set, so a SET clause is always present.
    const clauses = [`SET ${setParts.join(', ')}`];
    if (removeParts.length) clauses.push(`REMOVE ${removeParts.join(', ')}`);

    const result = await this.dynamoDb.client.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: { PK: `DEAL#${id}`, SK: 'METADATA' },
        UpdateExpression: clauses.join(' '),
        ExpressionAttributeNames: expressionNames,
        ExpressionAttributeValues: expressionValues,
        ConditionExpression: 'attribute_exists(PK)',
        ReturnValues: 'ALL_NEW',
      }),
    );

    // The schedule index key is built from four attributes, and a partial
    // update knows only the ones it carries — so it is restamped from the
    // row as it stands after the write, in a second, cheap write that only
    // scheduling / status changes pay for.
    if (Object.keys(attrs).some((k) => INDEX_KEY_FIELDS.has(k))) {
      return this.restampIndexKeys(id, result.Attributes!);
    }
    return this.toDeal(result.Attributes!);
  }

  /** The schedule and closed index keys, recomputed from the whole row. */
  private async restampIndexKeys(id: string, row: Record<string, unknown>): Promise<Deal> {
    const deal = this.toDeal(row);
    const schedule = statusScheduleKeys(deal);
    const closed = closedIndexKeys(deal);
    const sets = ['GSI5PK = :gsi5pk', 'GSI5SK = :gsi5sk'];
    const removes: string[] = [];
    const values: Record<string, unknown> = { ':gsi5pk': schedule.GSI5PK, ':gsi5sk': schedule.GSI5SK };
    if (schedule.slotStart) {
      sets.push('#slotStart = :slotStart');
      values[':slotStart'] = schedule.slotStart;
    } else {
      removes.push('#slotStart');
    }
    if (closed) {
      sets.push('GSI6PK = :gsi6pk', 'GSI6SK = :gsi6sk');
      values[':gsi6pk'] = closed.GSI6PK;
      values[':gsi6sk'] = closed.GSI6SK;
    } else {
      removes.push('GSI6PK', 'GSI6SK');
    }
    const result = await this.dynamoDb.client.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: { PK: `DEAL#${id}`, SK: 'METADATA' },
        UpdateExpression: `SET ${sets.join(', ')}${removes.length ? ` REMOVE ${removes.join(', ')}` : ''}`,
        ExpressionAttributeNames: { '#slotStart': 'slotStart' },
        ExpressionAttributeValues: values,
        ReturnValues: 'ALL_NEW',
      }),
    );
    return this.toDeal(result.Attributes!);
  }

  /**
   * Re-points a deal to another contact after a CRM contact merge. `contactId`
   * is immutable in `update()`, so the merge flow goes through this dedicated
   * write, which also moves the GSI3 contact index entry.
   */
  async reassignContact(id: string, newContactId: string): Promise<void> {
    await this.dynamoDb.client.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: { PK: `DEAL#${id}`, SK: 'METADATA' },
        UpdateExpression:
          'SET contactId = :contactId, GSI3PK = :gsi3pk, updatedAt = :updatedAt',
        ExpressionAttributeValues: {
          ':contactId': newContactId,
          ':gsi3pk': `CONTACT#${newContactId}`,
          ':updatedAt': new Date().toISOString(),
        },
        ConditionExpression: 'attribute_exists(PK)',
      }),
    );
  }

  async softDelete(id: string): Promise<void> {
    await this.update(id, { status: DealStatus.DELETED } as any);
  }

  /**
   * Reserves a random 6-char Job ID (uppercase letters + digits) by writing a
   * `DEALNUM#<code>` marker row guarded with attribute_not_exists. A collision
   * (the code already reserved) regenerates and retries; anything else rethrows.
   */
  async reserveDealNumber(dealId?: string): Promise<string> {
    const MAX_ATTEMPTS = 5;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const code = generateDealNumberCode();
      try {
        await this.dynamoDb.client.send(
          new PutCommand({
            TableName: this.tableName,
            // The reservation carries the deal it belongs to, so a Job ID
            // search is one GetItem (`findIdByNumber`) and never a scan.
            Item: { PK: `DEALNUM#${code}`, SK: 'UNIQUE', ...(dealId ? { dealId } : {}) },
            ConditionExpression: 'attribute_not_exists(PK)',
          }),
        );
        return code;
      } catch (error) {
        if ((error as Error).name !== 'ConditionalCheckFailedException') throw error;
        this.logger.warn(`Deal number ${code} already taken (attempt ${attempt}/${MAX_ATTEMPTS})`);
      }
    }
    throw new Error(`Could not reserve a unique deal number after ${MAX_ATTEMPTS} attempts`);
  }

  /**
   * The deal a Job ID code reserves: its id; `null` when no such code was
   * ever reserved; `undefined` when the reservation predates the link and
   * the caller has to fall back to a filtered read.
   */
  async findIdByNumber(code: string): Promise<string | null | undefined> {
    const result = await this.dynamoDb.client.send(
      new GetCommand({ TableName: this.tableName, Key: { PK: `DEALNUM#${code.toUpperCase()}`, SK: 'UNIQUE' } }),
    );
    if (!result.Item) return null;
    return (result.Item.dealId as string | undefined) ?? undefined;
  }

  private toDeal(item: Record<string, unknown>): Deal {
    return {
      id: item.id as string,
      // Legacy deals store a sequential number; new ones a 6-char code. Always a string in the domain.
      dealNumber: String(item.dealNumber ?? ''),
      contactId: item.contactId as string,
      companyId: item.companyId as string | undefined,
      clientType: item.clientType as Deal['clientType'],
      scheduledDate: item.scheduledDate as string | undefined,
      scheduledEndDate: item.scheduledEndDate as string | undefined,
      scheduledTimeSlot: item.scheduledTimeSlot as string | undefined,
      allDay: item.allDay as boolean | undefined,
      serviceArea: item.serviceArea as string,
      serviceAreaId: item.serviceAreaId as string | undefined,
      address: item.address as Deal['address'],
      jobTypeId: item.jobTypeId as string,
      // Prefer the stored super-status; derive it from the legacy stage for rows
      // not yet backfilled, so reads are correct before/after migration.
      superStatus:
        (item.superStatus as JobSuperStatus) ??
        STAGE_TO_SUPER_STATUS[item.stage as DealStage] ??
        JobSuperStatus.SUBMITTED,
      stage: item.stage as Deal['stage'],
      assignedTechIds: (item.assignedTechIds as string[]) || [],
      assignedDispatcherId: item.assignedDispatcherId as string,
      sequences: (item.sequences as Record<string, number>) || {},
      priority: item.priority as Deal['priority'],
      sourceId: item.sourceId as string | undefined,
      businessProfileId: item.businessProfileId as string | undefined,
      businessProfileName: item.businessProfileName as string | undefined,
      externalCompanyId: item.externalCompanyId as string | undefined,
      clientName: item.clientName as Deal['clientName'] | undefined,
      workOrderId: item.workOrderId as string | undefined,
      poNumber: item.poNumber as string | undefined,
      notes: item.notes as string | undefined,
      internalNotes: item.internalNotes as string | undefined,
      cancellationReason: item.cancellationReason as string | undefined,
      tagIds: (item.tagIds as string[]) || [],
      customFields: item.customFields as Deal['customFields'] | undefined,
      subStatusId: (item.subStatusId as string) || undefined,
      taxRateId: item.taxRateId as string | undefined,
      taxRateName: item.taxRateName as string | undefined,
      taxRatePercent: item.taxRatePercent as number | undefined,
      taxSource: item.taxSource as Deal['taxSource'] | undefined,
      discount: item.discount as Deal['discount'] | undefined,
      itemCount: item.itemCount as number | undefined,
      invoiceId: item.invoiceId as string | undefined,
      estimatedTotal: item.estimatedTotal as number | undefined,
      actualTotal: item.actualTotal as number | undefined,
      paymentStatus: item.paymentStatus as string | undefined,
      status: item.status as Deal['status'],
      createdBy: item.createdBy as string,
      statusChangedAt: item.statusChangedAt as string | undefined,
      closedAt: item.closedAt as string | undefined,
      // Carried over from Workiz — see `Deal`. Money attributes the importer
      // stores are deliberately not read until invoices are built.
      externalId: item.externalId as string | undefined,
      workizId: item.workizId as number | undefined,
      jobSerial: item.jobSerial as number | undefined,
      propId: item.propId as string | undefined,
      jobTimezone: item.jobTimezone as string | undefined,
      converted: item.converted as boolean | undefined,
      conversionDate: item.conversionDate as string | undefined,
      hasCalls: item.hasCalls as boolean | undefined,
      seen: item.seen as boolean | undefined,
      filesCount: item.filesCount as number | undefined,
      lastSent: item.lastSent as string | undefined,
      lastProgress: item.lastProgress as string | undefined,
      emailAddress: item.emailAddress as string | undefined,
      clientCompanyName: item.clientCompanyName as string | undefined,
      phones: item.phones as string[] | undefined,
      phoneExtensions: item.phoneExtensions as Record<string, string> | undefined,
      // Rows written before "Send to tech" existed simply have none of these.
      sentToTechAt: item.sentToTechAt as string | undefined,
      sentToTechVia: item.sentToTechVia as SendToTechChannel[] | undefined,
      sentToTechBy: item.sentToTechBy as string | undefined,
      seenByTechAt: item.seenByTechAt as string | undefined,
      // Technician flow. Absent on every row written before these fields
      // existed, which reads exactly as "not confirmed / not arrived yet".
      techConfirmedAt: item.techConfirmedAt as string | undefined,
      techConfirmedBy: item.techConfirmedBy as string | undefined,
      arrivedAt: item.arrivedAt as string | undefined,
      arrivedBy: item.arrivedBy as string | undefined,
      arrivedLocation: item.arrivedLocation as Deal['arrivedLocation'],
      createdAt: item.createdAt as string,
      updatedAt: item.updatedAt as string,
    };
  }

  private encodeCursor(
    lastEvaluatedKey?: Record<string, unknown>,
  ): string | undefined {
    if (!lastEvaluatedKey) return undefined;
    return Buffer.from(JSON.stringify(lastEvaluatedKey)).toString('base64url');
  }

  private decodeCursor(
    cursor?: string,
  ): Record<string, unknown> | undefined {
    if (!cursor) return undefined;
    return JSON.parse(Buffer.from(cursor, 'base64url').toString('utf-8'));
  }
}
