import { Injectable, Logger } from '@nestjs/common';
import { DynamoDbService } from '@bitcrm/shared';
import {
  DeleteCommand,
  GetCommand,
  PutCommand,
  QueryCommand,
  ScanCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import {
  CALLS_TABLE,
  extPk,
  extOfPk,
  extOfSk,
} from '../common/constants/dynamo.constants';

/** How long a released code stays unusable before it can be drawn again. */
const QUARANTINE_DAYS = Number(
  process.env.TELEPHONY_EXT_QUARANTINE_DAYS ?? 90,
);

export interface CallExt {
  code: string;
  dealId: string;
  /**
   * Which of the job's client numbers the code rings — the bridge's
   * `phoneIndex` order (see `clientLineAt`). Absent on codes minted before
   * codes were per number, which therefore read as the first number.
   */
  phoneIndex?: number;
  status: 'active' | 'released';
  createdAt: string;
  releasedAt?: string;
  /** When a released code may be drawn again. */
  quarantineUntil?: string;
}

/**
 * Job codes, in the calls table.
 *
 * Two items per (job, client number), and the second is not redundant:
 * without the reverse row a job screen re-render would mint a fresh code every
 * time, and a technician holding a printed work order would find it dead.
 *
 * ```
 * EXT#<code>      / METADATA   { code, dealId, phoneIndex?, status, … }
 * EXTOF#<dealId>  / METADATA   { code }  the first number's pointer (as it always was)
 * EXTOF#<dealId>  / PHONE#<i>  { code, phoneIndex }  every other number's
 * ```
 *
 * One partition per job holds every pointer, so closing a job finds all of
 * its codes with one Query.
 */
@Injectable()
export class ExtsRepository {
  private readonly logger = new Logger(ExtsRepository.name);

  constructor(private readonly dynamoDb: DynamoDbService) {}

  async findByCode(code: string): Promise<CallExt | null> {
    const res = await this.dynamoDb.client.send(
      new GetCommand({
        TableName: CALLS_TABLE,
        Key: { PK: extPk(code), SK: 'METADATA' },
      }),
    );
    return (res.Item as CallExt | undefined) ?? null;
  }

  /** The code for one of the job's numbers — the first when none is named. */
  async findByDeal(dealId: string, phoneIndex = 0): Promise<CallExt | null> {
    const res = await this.dynamoDb.client.send(
      new GetCommand({
        TableName: CALLS_TABLE,
        Key: { PK: extOfPk(dealId), SK: extOfSk(phoneIndex) },
      }),
    );
    const pointer = res.Item as { code?: string } | undefined;
    if (!pointer?.code) return null;
    return this.findByCode(pointer.code);
  }

  /** Every code the job's pointers name, active or released — one Query. */
  async listByDeal(dealId: string): Promise<CallExt[]> {
    const codes: string[] = [];
    let cursor: Record<string, unknown> | undefined;
    do {
      const res: {
        Items?: Array<Record<string, unknown>>;
        LastEvaluatedKey?: Record<string, unknown>;
      } = await this.dynamoDb.client.send(
        new QueryCommand({
          TableName: CALLS_TABLE,
          KeyConditionExpression: 'PK = :pk',
          ExpressionAttributeValues: { ':pk': extOfPk(dealId) },
          ExclusiveStartKey: cursor,
        }),
      );
      for (const item of res.Items ?? []) {
        if (typeof item.code === 'string') codes.push(item.code);
      }
      cursor = res.LastEvaluatedKey;
    } while (cursor);

    const found = await Promise.all(codes.map((code) => this.findByCode(code)));
    return found.filter((ext): ext is CallExt => !!ext);
  }

  /**
   * Take a code if nobody has ever held it.
   *
   * The condition is `attribute_not_exists(PK)` and NOT "status is released":
   * a code that connected somebody to the Hendersons must not, three weeks
   * later, connect somebody to the Wus. Released rows stay put until the
   * sweeper clears them past quarantine.
   *
   * Returns null when the code is taken, so the caller can redraw.
   */
  async claim(
    code: string,
    dealId: string,
    phoneIndex = 0,
  ): Promise<CallExt | null> {
    const now = new Date().toISOString();
    const item: CallExt = {
      code,
      dealId,
      phoneIndex,
      status: 'active',
      createdAt: now,
    };

    try {
      await this.dynamoDb.client.send(
        new PutCommand({
          TableName: CALLS_TABLE,
          Item: { PK: extPk(code), SK: 'METADATA', ...item },
          ConditionExpression: 'attribute_not_exists(PK)',
        }),
      );
    } catch (error) {
      if ((error as { name?: string }).name === 'ConditionalCheckFailedException') {
        return null;
      }
      throw error;
    }

    // The pointer is written second and overwritten freely: a job that had an
    // older, released code simply points at the new one.
    await this.dynamoDb.client.send(
      new PutCommand({
        TableName: CALLS_TABLE,
        Item: {
          PK: extOfPk(dealId),
          SK: extOfSk(phoneIndex),
          dealId,
          code,
          phoneIndex,
          updatedAt: now,
        },
      }),
    );
    return item;
  }

  /** Retire a code. It stays in the table, unusable, until swept. */
  async release(code: string): Promise<void> {
    const now = new Date();
    const until = new Date(now.getTime() + QUARANTINE_DAYS * 86_400_000);
    await this.dynamoDb.client
      .send(
        new UpdateCommand({
          TableName: CALLS_TABLE,
          Key: { PK: extPk(code), SK: 'METADATA' },
          UpdateExpression:
            'SET #status = :released, #releasedAt = :now, #until = :until',
          ExpressionAttributeNames: {
            '#status': 'status',
            '#releasedAt': 'releasedAt',
            '#until': 'quarantineUntil',
          },
          ExpressionAttributeValues: {
            ':released': 'released',
            ':now': now.toISOString(),
            ':until': until.toISOString(),
          },
          ConditionExpression: 'attribute_exists(PK)',
        }),
      )
      .catch(() => undefined);
  }

  /**
   * Released codes whose quarantine has passed — the sweeper's input.
   *
   * A Scan, deliberately. Nothing in this repo uses DynamoDB TTL, so expiry is
   * a scheduled job; and adding a GSI to the calls table to serve housekeeping
   * that runs nightly would cost more than the scan does. Paged so a large
   * table cannot blow the Lambda's memory.
   */
  async listSweepable(now = new Date(), limit = 500): Promise<string[]> {
    const codes: string[] = [];
    let cursor: Record<string, unknown> | undefined;

    do {
      const res: {
        Items?: Array<Record<string, unknown>>;
        LastEvaluatedKey?: Record<string, unknown>;
      } = await this.dynamoDb.client.send(
        new ScanCommand({
          TableName: CALLS_TABLE,
          FilterExpression:
            'begins_with(PK, :ext) AND #status = :released AND #until < :now',
          ExpressionAttributeNames: {
            '#status': 'status',
            '#until': 'quarantineUntil',
          },
          ExpressionAttributeValues: {
            ':ext': 'EXT#',
            ':released': 'released',
            ':now': now.toISOString(),
          },
          ExclusiveStartKey: cursor,
        }),
      );
      for (const item of res.Items ?? []) {
        if (typeof item.code === 'string') codes.push(item.code);
        if (codes.length >= limit) return codes;
      }
      cursor = res.LastEvaluatedKey;
    } while (cursor);

    return codes;
  }

  /** Drop a swept row for good. */
  async purge(code: string): Promise<void> {
    await this.dynamoDb.client
      .send(
        new DeleteCommand({
          TableName: CALLS_TABLE,
          Key: { PK: extPk(code), SK: 'METADATA' },
        }),
      )
      .catch(() => undefined);
  }
}
