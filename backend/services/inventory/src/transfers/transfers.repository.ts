import { BadRequestException, Injectable } from '@nestjs/common';
import {
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import {
  DynamoDbService,
  countRows,
  type CountRowsResult,
} from '@bitcrm/shared';
import { fillPage } from '../common/utils/fill-page';
import { batchGetAll } from '../common/utils/batch-get';
import { decodeIndexCursor, encodeIndexCursor } from '../common/utils/index-cursor';
import { type Transfer, type TransferType } from '@bitcrm/types';
import {
  INVENTORY_TABLE,
  GSI1_NAME,
  GSI4_NAME,
} from '../common/constants/dynamo.constants';
import { monthsDescending } from '../inventory-log/inventory-log.constants';
import {
  MONTH_PATTERN,
  TRANSFERS_FLOOR_KEY,
  TRANSFERS_INDEX_PREFIX,
  transferIndexKeys,
  transferMonth,
} from './transfers.constants';

export interface PaginatedResult {
  items: Transfer[];
  nextCursor?: string;
}

/** The filters the list and its count share. */
export interface TransferListFilters {
  type?: TransferType;
}

/** Where a page of the month walk stopped: a month, and inside it the last row handed out. */
interface MonthCursor {
  month: string;
  lastKey?: Record<string, unknown>;
}

/** A month-index cursor names the table keys and the GSI1 keys. */
const MONTH_CURSOR_KEYS = ['PK', 'SK', 'GSI1PK', 'GSI1SK'] as const;
/** A GSI4 (entity) cursor names the table keys and the GSI4 keys. */
const ENTITY_CURSOR_KEYS = ['PK', 'SK', 'GSI4PK', 'GSI4SK'] as const;

/**
 * DynamoDB reads one list request may spend across the months it walks — the
 * log's budget. A rare `type` over a busy stretch hands a cursor back rather
 * than read on.
 */
const MAX_READS = 20;

/** Month counts asked at once. */
const COUNT_CONCURRENCY = 4;

/**
 * Transfer rows in the single BitCRM_Inventory table:
 *   PK = TRANSFER#<id>, SK = METADATA — the transfer itself;
 *     GSI1PK = TRANSFERS#<YYYY-MM>, GSI1SK = <createdAt>#<id> (CategoryIndex) —
 *     the list, one partition per UTC month, walked newest first;
 *     when it has a source, GSI4PK = ENTITY#<fromType>#<fromId>,
 *     GSI4SK = TRANSFER#<createdAt>#<id> (TransferEntityIndex)
 *   PK = TRANSFERS#INDEX, SK = METADATA — { firstMonth }: the oldest month
 *     filed, where the walk and the count stop (only ever moves down)
 *   PK = TRANSFER#<id>, SK = ENTITY_REF#<toType>#<toId> — a { transferId }
 *     pointer carrying the same GSI4 keys for the destination, so one Query
 *     lists a location's movements in and out
 * `dealId` (deduct / restore) and `reason` (return) ride on the transfer row.
 */
@Injectable()
export class TransfersRepository {
  constructor(private readonly dynamoDb: DynamoDbService) {}

  async create(transfer: Transfer): Promise<void> {
    // Convert to plain object to avoid DynamoDB marshalling issues with class instances
    const plainTransfer = JSON.parse(JSON.stringify(transfer));

    // The walk's floor first, so the row is never filed below it.
    await this.moveFloorTo(transferMonth(transfer.createdAt));

    // Main transfer record
    await this.dynamoDb.client.send(
      new PutCommand({
        TableName: INVENTORY_TABLE,
        Item: {
          PK: `TRANSFER#${transfer.id}`,
          SK: 'METADATA',
          // The list: this transfer's month partition, by time.
          ...transferIndexKeys(transfer),
          // GSI4 for source entity lookup
          ...(transfer.fromId && {
            GSI4PK: `ENTITY#${transfer.fromType}#${transfer.fromId}`,
            GSI4SK: `TRANSFER#${transfer.createdAt}#${transfer.id}`,
          }),
          ...plainTransfer,
        },
      }),
    );

    // If there's a destination, create a second record for destination lookup
    if (transfer.toId && transfer.fromId) {
      await this.dynamoDb.client.send(
        new PutCommand({
          TableName: INVENTORY_TABLE,
          Item: {
            PK: `TRANSFER#${transfer.id}`,
            SK: `ENTITY_REF#${transfer.toType}#${transfer.toId}`,
            GSI4PK: `ENTITY#${transfer.toType}#${transfer.toId}`,
            GSI4SK: `TRANSFER#${transfer.createdAt}#${transfer.id}`,
            transferId: transfer.id,
          },
        }),
      );
    } else if (transfer.toId && !transfer.fromId) {
      // Receive: only destination, write GSI4 on main record
      await this.dynamoDb.client.send(
        new PutCommand({
          TableName: INVENTORY_TABLE,
          Item: {
            PK: `TRANSFER#${transfer.id}`,
            SK: `ENTITY_REF#${transfer.toType}#${transfer.toId}`,
            GSI4PK: `ENTITY#${transfer.toType}#${transfer.toId}`,
            GSI4SK: `TRANSFER#${transfer.createdAt}#${transfer.id}`,
            transferId: transfer.id,
          },
        }),
      );
    }
  }

  async findById(id: string): Promise<Transfer | null> {
    const result = await this.dynamoDb.client.send(
      new GetCommand({
        TableName: INVENTORY_TABLE,
        Key: { PK: `TRANSFER#${id}`, SK: 'METADATA' },
      }),
    );

    if (!result.Item) return null;
    return this.toTransfer(result.Item);
  }

  /**
   * The oldest month a transfer is filed under moves down to `month` when it
   * is later or unset — a conditional write, so it never moves up.
   */
  private async moveFloorTo(month: string): Promise<void> {
    try {
      await this.dynamoDb.client.send(
        new UpdateCommand({
          TableName: INVENTORY_TABLE,
          Key: { ...TRANSFERS_FLOOR_KEY },
          UpdateExpression: 'SET firstMonth = :month',
          ConditionExpression: 'attribute_not_exists(firstMonth) OR firstMonth > :month',
          ExpressionAttributeValues: { ':month': month },
        }),
      );
    } catch (error: unknown) {
      if (error instanceof Error && error.name === 'ConditionalCheckFailedException') return;
      throw error;
    }
  }

  /** The oldest month filed, or undefined when no transfer ever was. */
  private async firstMonth(): Promise<string | undefined> {
    const { Item } = await this.dynamoDb.client.send(
      new GetCommand({ TableName: INVENTORY_TABLE, Key: { ...TRANSFERS_FLOOR_KEY } }),
    );
    const month = Item?.firstMonth;
    return typeof month === 'string' && MONTH_PATTERN.test(month) ? month : undefined;
  }

  /** The UTC month now — a method so a test can pin it. */
  protected currentMonth(): string {
    return new Date().toISOString().slice(0, 7);
  }

  /**
   * One location's movements in and out, newest first, off GSI4. A reference
   * row (the destination side) names its transfer; those are read in one
   * BatchGet — they used to be one GetItem each, one after another.
   */
  async findByEntity(
    entityType: string,
    entityId: string,
    limit: number,
    cursor?: string,
  ): Promise<PaginatedResult> {
    const startKey = decodeIndexCursor(cursor, ENTITY_CURSOR_KEYS);
    const result = await this.dynamoDb.client.send(
      new QueryCommand({
        TableName: INVENTORY_TABLE,
        IndexName: GSI4_NAME,
        KeyConditionExpression: 'GSI4PK = :pk',
        ExpressionAttributeValues: {
          ':pk': `ENTITY#${entityType}#${entityId}`,
        },
        ScanIndexForward: false, // newest first
        Limit: limit,
        ...(startKey ? { ExclusiveStartKey: startKey } : {}),
      }),
    );

    const rows = result.Items ?? [];
    const referenced = rows
      .filter((item) => !item.type && item.transferId)
      .map((item) => item.transferId as string);
    const byId = new Map<string, Transfer>();
    if (referenced.length > 0) {
      const found = await batchGetAll(
        this.dynamoDb.client,
        referenced.map((id) => ({ PK: `TRANSFER#${id}`, SK: 'METADATA' })),
      );
      for (const item of found) byId.set(item.id as string, this.toTransfer(item));
    }

    const items: Transfer[] = [];
    for (const item of rows) {
      if (item.type) items.push(this.toTransfer(item));
      else if (item.transferId && byId.has(item.transferId as string)) {
        items.push(byId.get(item.transferId as string)!);
      }
    }

    return {
      items,
      nextCursor: encodeIndexCursor(result.LastEvaluatedKey),
    };
  }

  /** The month Query, with the `type` filter on top when there is one. */
  private monthQuery(month: string, filters?: TransferListFilters) {
    return {
      TableName: INVENTORY_TABLE,
      IndexName: GSI1_NAME,
      KeyConditionExpression: 'GSI1PK = :pk',
      ExpressionAttributeValues: {
        ':pk': `${TRANSFERS_INDEX_PREFIX}${month}`,
        ...(filters?.type && { ':type': filters.type }),
      },
      // `type` is a DynamoDB reserved word.
      ...(filters?.type && {
        FilterExpression: '#type = :type',
        ExpressionAttributeNames: { '#type': 'type' },
      }),
    };
  }

  /**
   * One month, newest first. Unfiltered, a Query is the page; filtered, the
   * page is filled across reads within what is left of the budget.
   */
  private async readMonth(
    month: string,
    filters: TransferListFilters | undefined,
    limit: number,
    startKey: Record<string, unknown> | undefined,
    maxReads: number,
  ): Promise<{ items: Record<string, unknown>[]; lastKey?: Record<string, unknown>; reads: number }> {
    const query = this.monthQuery(month, filters);
    let reads = 0;
    const read = (input: { Limit: number; ExclusiveStartKey?: Record<string, unknown> }) => {
      reads += 1;
      return this.dynamoDb.client.send(new QueryCommand({ ...query, ScanIndexForward: false, ...input }));
    };

    if (!filters?.type) {
      const result = await read({ Limit: limit, ...(startKey ? { ExclusiveStartKey: startKey } : {}) });
      return { items: result.Items ?? [], lastKey: result.LastEvaluatedKey, reads };
    }
    const page = await fillPage<Record<string, unknown>>(read, limit, {
      startKey,
      maxReads,
      keyOf: (i) => ({ PK: i.PK, SK: i.SK, GSI1PK: i.GSI1PK, GSI1SK: i.GSI1SK }),
    });
    return { items: page.items, lastKey: page.lastKey, reads };
  }

  /**
   * Newest first: the current month's partition, then the one before, down
   * to the first month any transfer was filed under — each read until it
   * ends or the page is full, within one read budget for the whole page. The
   * cursor names the month and, inside it, the last row handed out.
   */
  async findAll(
    limit: number,
    cursor?: string,
    filters?: TransferListFilters,
  ): Promise<PaginatedResult> {
    // Decoded before any read: a Scan-era or foreign cursor is a 400, not a 500.
    const position = this.decodeMonthCursor(cursor);
    const floor = await this.firstMonth();
    if (!floor) return { items: [], nextCursor: undefined };

    const months = monthsDescending(floor, this.currentMonth());
    let index = position ? months.indexOf(position.month) : 0;
    if (index < 0) return { items: [], nextCursor: undefined };

    const items: Record<string, unknown>[] = [];
    let key = position?.lastKey;
    let reads = 0;
    for (; index < months.length; index++) {
      const month = months[index];
      while (items.length < limit) {
        if (reads >= MAX_READS) {
          return this.pageOf(items, { month, lastKey: key });
        }
        const page = await this.readMonth(month, filters, limit - items.length, key, MAX_READS - reads);
        // An empty month is one cheap read the floor already bounds; charging
        // it would hand back empty pages with a cursor across quiet months.
        if (page.items.length > 0 || page.lastKey) reads += page.reads;
        items.push(...page.items);
        key = page.lastKey;
        if (!key) break;
      }

      if (items.length >= limit) {
        if (key) return this.pageOf(items, { month, lastKey: key });
        // The month ended on the page boundary: the next page starts the next month.
        const next = months[index + 1];
        return this.pageOf(items, next ? { month: next } : undefined);
      }
      key = undefined;
    }
    return this.pageOf(items, undefined);
  }

  private pageOf(items: Record<string, unknown>[], next: MonthCursor | undefined): PaginatedResult {
    return {
      items: items.map((item) => this.toTransfer(item)),
      nextCursor: next ? Buffer.from(JSON.stringify(next)).toString('base64url') : undefined,
    };
  }

  private decodeMonthCursor(cursor?: string): MonthCursor | undefined {
    if (!cursor) return undefined;
    let value: unknown;
    try {
      value = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf-8'));
    } catch {
      throw new BadRequestException('Invalid cursor');
    }
    const position = value as Partial<MonthCursor> | null;
    if (!position || typeof position.month !== 'string' || !MONTH_PATTERN.test(position.month)) {
      throw new BadRequestException('Invalid cursor');
    }
    if (position.lastKey !== undefined) {
      const lastKey = position.lastKey as Record<string, unknown> | null;
      if (!lastKey || MONTH_CURSOR_KEYS.some((attr) => typeof lastKey[attr] !== 'string')) {
        throw new BadRequestException('Invalid cursor');
      }
    }
    return { month: position.month, ...(position.lastKey && { lastKey: position.lastKey }) };
  }

  /**
   * How many transfers the list holds under the same `type` filter — every
   * month from the first to the current one counted without bodies (a few at
   * once) and added up; "at least" if any month's walk hit its ceiling.
   */
  async countAll(filters?: TransferListFilters): Promise<CountRowsResult> {
    const floor = await this.firstMonth();
    if (!floor) return { total: 0, atLeast: false };
    const months = monthsDescending(floor, this.currentMonth());

    const counts: CountRowsResult[] = [];
    let next = 0;
    const worker = async () => {
      while (next < months.length) {
        const query = this.monthQuery(months[next++], filters);
        counts.push(
          await countRows((input) =>
            this.dynamoDb.client.send(new QueryCommand({ ...query, Select: 'COUNT', ...input })),
          ),
        );
      }
    };
    await Promise.all(Array.from({ length: Math.min(COUNT_CONCURRENCY, months.length) }, () => worker()));

    return {
      total: counts.reduce((sum, c) => sum + c.total, 0),
      atLeast: counts.some((c) => c.atLeast),
    };
  }

  private toTransfer(item: Record<string, unknown>): Transfer {
    return {
      id: item.id as string,
      type: item.type as Transfer['type'],
      fromType: (item.fromType as Transfer['fromType']) || null,
      fromId: (item.fromId as string) || null,
      toType: (item.toType as Transfer['toType']) || null,
      toId: (item.toId as string) || null,
      items: (item.items as Transfer['items']) || [],
      performedBy: item.performedBy as string,
      performedByName: item.performedByName as string,
      notes: item.notes as string | undefined,
      dealId: item.dealId as string | undefined,
      reason: item.reason as Transfer['reason'],
      createdAt: item.createdAt as string,
    };
  }
}
