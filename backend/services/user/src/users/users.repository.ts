import { Injectable, Logger } from '@nestjs/common';
import {
  BatchGetCommand,
  DeleteCommand,
  GetCommand,
  PutCommand,
  QueryCommand,
  ScanCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import {
  DynamoDbService,
  scanPage,
  countRows,
  type CountRowsResult,
} from '@bitcrm/shared';
import { type User, UserStatus } from '@bitcrm/types';
import { USERS_TABLE, GSI1_NAME, GSI2_NAME } from './constants/dynamo.constants';

interface PaginatedResult {
  items: User[];
  nextCursor?: string;
}

/** The projection `findNamesByIds` reads — a name join and nothing more. */
export interface UserNameRow {
  id: string;
  firstName: string;
  lastName: string;
  workizName?: string;
}

/** BatchGetItem's hard limit on keys per request. */
const BATCH_GET_MAX_KEYS = 100;
/** Re-asks for `UnprocessedKeys` before a chunk settles for what it has. */
const BATCH_GET_MAX_RETRIES = 5;
const BATCH_GET_BACKOFF_MS = 20;

@Injectable()
export class UsersRepository {
  private readonly logger = new Logger(UsersRepository.name);

  constructor(private readonly dynamoDb: DynamoDbService) {}

  async create(user: User): Promise<void> {
    await this.dynamoDb.client.send(
      new PutCommand({
        TableName: USERS_TABLE,
        Item: {
          PK: `USER#${user.id}`,
          SK: 'METADATA',
          GSI1PK: `ROLE_USER#${user.roleId}`,
          GSI1SK: `USER#${user.id}`,
          GSI2PK: `DEPT#${user.department}`,
          GSI2SK: `USER#${user.id}`,
          ...user,
        },
        ConditionExpression: 'attribute_not_exists(PK)',
      }),
    );
  }

  async findById(id: string): Promise<User | null> {
    const result = await this.dynamoDb.client.send(
      new GetCommand({
        TableName: USERS_TABLE,
        Key: { PK: `USER#${id}`, SK: 'METADATA' },
      }),
    );

    if (!result.Item) return null;
    return this.toUser(result.Item);
  }

  /**
   * Names for a set of ids: `USER#<id> / METADATA`, BatchGetItem in chunks of
   * 100 run in parallel, projected to `id, firstName, lastName, workizName`.
   *
   * Answers in no particular order and simply leaves out ids with no row.
   * Throttled keys (`UnprocessedKeys`) are re-asked with a short exponential
   * backoff; a chunk that still has some after the retries, or that throws,
   * costs only its own names — one bad read must not cost the caller every
   * other teammate's name.
   */
  async findNamesByIds(ids: string[]): Promise<UserNameRow[]> {
    const chunks: string[][] = [];
    for (let i = 0; i < ids.length; i += BATCH_GET_MAX_KEYS) {
      chunks.push(ids.slice(i, i + BATCH_GET_MAX_KEYS));
    }
    const answers = await Promise.all(
      chunks.map((chunk) =>
        this.batchGetNames(chunk).catch((err: Error) => {
          this.logger.warn(`names-by-ids: a chunk of ${chunk.length} failed (${err.message})`);
          return [] as UserNameRow[];
        }),
      ),
    );
    return answers.flat();
  }

  private async batchGetNames(ids: string[]): Promise<UserNameRow[]> {
    const rows: UserNameRow[] = [];
    let keys: Record<string, unknown>[] = ids.map((id) => ({ PK: `USER#${id}`, SK: 'METADATA' }));

    for (let attempt = 0; keys.length > 0; attempt++) {
      if (attempt > 0) {
        if (attempt > BATCH_GET_MAX_RETRIES) {
          this.logger.warn(`names-by-ids: ${keys.length} key(s) still unprocessed, left out`);
          break;
        }
        await new Promise((r) => setTimeout(r, BATCH_GET_BACKOFF_MS * 2 ** (attempt - 1)));
      }
      const result = await this.dynamoDb.client.send(
        new BatchGetCommand({
          RequestItems: {
            [USERS_TABLE]: {
              Keys: keys,
              ProjectionExpression: '#id, #fn, #ln, #wn',
              ExpressionAttributeNames: {
                '#id': 'id',
                '#fn': 'firstName',
                '#ln': 'lastName',
                '#wn': 'workizName',
              },
            },
          },
        }),
      );
      rows.push(...((result.Responses?.[USERS_TABLE] ?? []) as UserNameRow[]));
      keys = result.UnprocessedKeys?.[USERS_TABLE]?.Keys ?? [];
    }
    return rows;
  }

  async findByRole(
    role: string,
    limit: number,
    cursor?: string,
  ): Promise<PaginatedResult> {
    const result = await this.dynamoDb.client.send(
      new QueryCommand({
        TableName: USERS_TABLE,
        IndexName: GSI1_NAME,
        KeyConditionExpression: 'GSI1PK = :pk',
        ExpressionAttributeValues: { ':pk': `ROLE_USER#${role}` },
        Limit: limit,
        ExclusiveStartKey: this.decodeCursor(cursor),
      }),
    );

    return {
      items: (result.Items || []).map(this.toUser),
      nextCursor: this.encodeCursor(result.LastEvaluatedKey),
    };
  }

  async findByDepartment(
    department: string,
    limit: number,
    cursor?: string,
  ): Promise<PaginatedResult> {
    const result = await this.dynamoDb.client.send(
      new QueryCommand({
        TableName: USERS_TABLE,
        IndexName: GSI2_NAME,
        KeyConditionExpression: 'GSI2PK = :pk',
        ExpressionAttributeValues: { ':pk': `DEPT#${department}` },
        Limit: limit,
        ExclusiveStartKey: this.decodeCursor(cursor),
      }),
    );

    return {
      items: (result.Items || []).map(this.toUser),
      nextCursor: this.encodeCursor(result.LastEvaluatedKey),
    };
  }

  /* ---------------------------------------------------------- phone index */

  /**
   * Phone → user lookup items, mirroring the CRM's contact phone index:
   * `PK=PHONE#<e164>, SK=USER`. An index item rather than a GSI, so no table
   * migration — and the `begins_with(PK, 'USER#')` scans that list users skip
   * these rows for free.
   */
  async putPhoneIndex(phone: string, userId: string): Promise<void> {
    await this.dynamoDb.client.send(
      new PutCommand({
        TableName: USERS_TABLE,
        Item: { PK: `PHONE#${phone}`, SK: 'USER', phone, userId },
      }),
    );
  }

  async deletePhoneIndex(phone: string): Promise<void> {
    await this.dynamoDb.client.send(
      new DeleteCommand({
        TableName: USERS_TABLE,
        Key: { PK: `PHONE#${phone}`, SK: 'USER' },
      }),
    );
  }

  /** The user who owns this (already normalized) number, if any. */
  async findByPhone(normalizedPhone: string): Promise<User | null> {
    const result = await this.dynamoDb.client.send(
      new GetCommand({
        TableName: USERS_TABLE,
        Key: { PK: `PHONE#${normalizedPhone}`, SK: 'USER' },
      }),
    );
    const userId = result.Item?.userId as string | undefined;
    return userId ? this.findById(userId) : null;
  }

  /**
   * The table holds far more than users — a technician's job types, service
   * areas, commission rows and profile all share it — so a filtered Scan reads
   * mostly rows it will throw away. `scanPage` keeps reading until the page is
   * full; asking DynamoDB for `limit` once returned nine users out of a
   * hundred rows read, and every screen resolving a name through the directory
   * fell back to "Unknown".
   */
  async findAll(limit: number, cursor?: string): Promise<PaginatedResult> {
    const page = await scanPage<Record<string, unknown>>(
      (input) =>
        this.dynamoDb.client.send(
          new ScanCommand({
            TableName: USERS_TABLE,
            FilterExpression: 'begins_with(PK, :pk) AND SK = :sk',
            ExpressionAttributeValues: { ':pk': 'USER#', ':sk': 'METADATA' },
            ...input,
          }),
        ),
      limit,
      { startKey: this.decodeCursor(cursor), keyOf: (i) => ({ PK: i.PK, SK: i.SK }) },
    );

    return {
      items: page.items.map(this.toUser),
      nextCursor: this.encodeCursor(page.lastKey),
    };
  }

  /**
   * How many users the list holds — the number behind "Page 2 of 7".
   *
   * `Select: 'COUNT'` keeps the bodies off the wire, and the walk is bounded:
   * this is a Scan over a table where a technician's job types, service areas,
   * commission rows and profile all sit beside the user records, so counting
   * without a ceiling would read the lot on every page load.
   */
  async countAll(): Promise<CountRowsResult> {
    return countRows((input) =>
      this.dynamoDb.client.send(
        new ScanCommand({
          TableName: USERS_TABLE,
          FilterExpression: 'begins_with(PK, :pk) AND SK = :sk',
          ExpressionAttributeValues: { ':pk': 'USER#', ':sk': 'METADATA' },
          Select: 'COUNT',
          ...input,
        }),
      ),
    );
  }

  /** The same count under the list's status filter. */
  async countByStatus(status: UserStatus): Promise<CountRowsResult> {
    return countRows((input) =>
      this.dynamoDb.client.send(
        new ScanCommand({
          TableName: USERS_TABLE,
          FilterExpression: 'begins_with(PK, :pk) AND SK = :sk AND #status = :status',
          ExpressionAttributeNames: { '#status': 'status' },
          ExpressionAttributeValues: {
            ':pk': 'USER#',
            ':sk': 'METADATA',
            ':status': status,
          },
          Select: 'COUNT',
          ...input,
        }),
      ),
    );
  }

  /** One department, on the department index — a Query, so the cheap end. */
  async countByDepartment(department: string): Promise<CountRowsResult> {
    return countRows((input) =>
      this.dynamoDb.client.send(
        new QueryCommand({
          TableName: USERS_TABLE,
          IndexName: GSI2_NAME,
          KeyConditionExpression: 'GSI2PK = :pk',
          ExpressionAttributeValues: { ':pk': `DEPT#${department}` },
          Select: 'COUNT',
          ...input,
        }),
      ),
    );
  }

  async findByStatus(
    status: UserStatus,
    limit: number,
    cursor?: string,
  ): Promise<PaginatedResult> {
    const page = await scanPage<Record<string, unknown>>(
      (input) =>
        this.dynamoDb.client.send(
          new ScanCommand({
            TableName: USERS_TABLE,
            FilterExpression:
              'begins_with(PK, :pk) AND SK = :sk AND #status = :status',
            ExpressionAttributeNames: { '#status': 'status' },
            ExpressionAttributeValues: {
              ':pk': 'USER#',
              ':sk': 'METADATA',
              ':status': status,
            },
            ...input,
          }),
        ),
      limit,
      { startKey: this.decodeCursor(cursor), keyOf: (i) => ({ PK: i.PK, SK: i.SK }) },
    );

    return {
      items: page.items.map(this.toUser),
      nextCursor: this.encodeCursor(page.lastKey),
    };
  }

  async update(id: string, attrs: Partial<User>): Promise<User> {
    const setParts: string[] = [];
    const removeParts: string[] = [];
    const expressionNames: Record<string, string> = {};
    const expressionValues: Record<string, unknown> = {};

    const now = new Date().toISOString();
    const updates = { ...attrs, updatedAt: now };

    // Rebuild GSI keys if roleId or department changed
    if (attrs.roleId) {
      updates['GSI1PK' as keyof typeof updates] = `ROLE_USER#${attrs.roleId}` as never;
      updates['GSI1SK' as keyof typeof updates] = `USER#${id}` as never;
    }
    if (attrs.department) {
      updates['GSI2PK' as keyof typeof updates] = `DEPT#${attrs.department}` as never;
      updates['GSI2SK' as keyof typeof updates] = `USER#${id}` as never;
    }

    const immutableKeys = new Set(['id', 'cognitoSub', 'email']);
    for (const [key, value] of Object.entries(updates)) {
      if (immutableKeys.has(key)) continue;
      const attrName = `#${key}`;
      expressionNames[attrName] = key;
      if (value === undefined) {
        // Use REMOVE for undefined values to clear the attribute
        // Only remove explicitly passed keys (not updatedAt)
        if (key in attrs) {
          removeParts.push(attrName);
        }
      } else {
        const attrValue = `:${key}`;
        setParts.push(`${attrName} = ${attrValue}`);
        expressionValues[attrValue] = value;
      }
    }

    const expressionSegments: string[] = [];
    if (setParts.length > 0) {
      expressionSegments.push(`SET ${setParts.join(', ')}`);
    }
    if (removeParts.length > 0) {
      expressionSegments.push(`REMOVE ${removeParts.join(', ')}`);
    }

    const result = await this.dynamoDb.client.send(
      new UpdateCommand({
        TableName: USERS_TABLE,
        Key: { PK: `USER#${id}`, SK: 'METADATA' },
        UpdateExpression: expressionSegments.join(' '),
        ExpressionAttributeNames: expressionNames,
        ExpressionAttributeValues: Object.keys(expressionValues).length > 0 ? expressionValues : undefined,
        ConditionExpression: 'attribute_exists(PK)',
        ReturnValues: 'ALL_NEW',
      }),
    );

    return this.toUser(result.Attributes!);
  }

  /**
   * The sign-in account made for a user who had none (imported from Workiz).
   * `update` never writes `cognitoSub`, and this never replaces one.
   */
  async attachSignInAccount(id: string, cognitoSub: string): Promise<void> {
    await this.dynamoDb.client.send(
      new UpdateCommand({
        TableName: USERS_TABLE,
        Key: { PK: `USER#${id}`, SK: 'METADATA' },
        UpdateExpression: 'SET #cognitoSub = :cognitoSub, #updatedAt = :updatedAt',
        ExpressionAttributeNames: { '#cognitoSub': 'cognitoSub', '#updatedAt': 'updatedAt' },
        ExpressionAttributeValues: {
          ':cognitoSub': cognitoSub,
          ':updatedAt': new Date().toISOString(),
        },
        ConditionExpression: 'attribute_exists(PK) AND attribute_not_exists(cognitoSub)',
      }),
    );
  }

  /**
   * Every user holding a role — paged to exhaustion, not to DynamoDB's 1MB.
   *
   * A truncated answer here is not a short list, it is a wrong one, and the
   * two callers that matter both read absence as a fact: deal-service
   * reconciles its dispatch projection against this roster and deletes the
   * technicians missing from it, and the last-Super-Admin guard refuses a
   * demotion when it finds no other active Super Admin. The sibling calls in
   * the same fan-out (`listAllApproved`, `listAllTechnicianProfiles`) already
   * page; this one did not.
   */
  async findByRoleId(roleId: string): Promise<User[]> {
    const users: User[] = [];
    let lastKey: Record<string, unknown> | undefined;

    do {
      const result = await this.dynamoDb.client.send(
        new QueryCommand({
          TableName: USERS_TABLE,
          IndexName: GSI1_NAME,
          KeyConditionExpression: 'GSI1PK = :pk',
          ExpressionAttributeValues: { ':pk': `ROLE_USER#${roleId}` },
          ExclusiveStartKey: lastKey,
        }),
      );
      users.push(...(result.Items || []).map(this.toUser));
      lastKey = result.LastEvaluatedKey;
    } while (lastKey);

    return users;
  }

  private toUser(item: Record<string, unknown>): User {
    return {
      id: item.id as string,
      cognitoSub: item.cognitoSub as string,
      email: item.email as string,
      firstName: item.firstName as string,
      lastName: item.lastName as string,
      // Workiz's whole name for an imported person ("(2) TX - Daniel Munoz");
      // the screens that mirror Workiz print it. Absent on users made here.
      workizName: (item.workizName as string | undefined) || undefined,
      roleId: (item.roleId as string) || '',
      department: item.department as string,
      // Their own number. Every read goes through here, so omitting it didn't
      // just hide the field: an edit form defaulting from it would clear the
      // stored number, and `applyPhoneChange` — which compares against what it
      // reads here — never deleted the old lookup item when a number changed,
      // leaving numbers that could never be claimed again.
      phone: item.phone as string | undefined,
      // Absent on records from before the flag; `isFieldTeamMember` answers
      // from the role for those, so nothing is defaulted here.
      fieldTeamMember: item.fieldTeamMember as boolean | undefined,
      // Workiz's "User type"; absent = a User (everyone from before it).
      userType: (item.userType as User['userType']) || undefined,
      smsMfaEnabled: item.smsMfaEnabled as boolean | undefined,
      status: item.status as User['status'],
      permissionOverrides: item.permissionOverrides as User['permissionOverrides'],
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
