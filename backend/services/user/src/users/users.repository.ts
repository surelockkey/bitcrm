import { Injectable } from '@nestjs/common';
import {
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
  type CountReadInput,
  type CountRowsResult,
  type ScanReadInput,
  type ScanReadOutput,
} from '@bitcrm/shared';
import { type User, UserStatus } from '@bitcrm/types';
import { USERS_TABLE, GSI1_NAME, GSI2_NAME } from './constants/dynamo.constants';
import { USER_SEARCH_ATTRIBUTES, normalizeUserSearch, userMatchesSearch } from './user-search';

type Row = Record<string, unknown>;
type RowRead = (input: ScanReadInput) => Promise<ScanReadOutput<Row>>;

/** A read whose rows are cut down to the users the search term matches. */
function searched(read: RowRead, term: string | undefined): RowRead {
  if (!term) return read;
  return async (input) => {
    const out = await read(input);
    return { ...out, Items: (out.Items ?? []).filter((row) => userMatchesSearch(row, term)) };
  };
}

/** Projection of a searched count: the fields the match reads, nothing else. */
const SEARCH_PROJECTION = {
  ProjectionExpression: USER_SEARCH_ATTRIBUTES.map((a) => `#${a}`).join(', '),
  names: Object.fromEntries(USER_SEARCH_ATTRIBUTES.map((a) => [`#${a}`, a])),
};

interface PaginatedResult {
  items: User[];
  nextCursor?: string;
}

@Injectable()
export class UsersRepository {
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

  /**
   * One department on the department index. Unsearched, one Query is exactly
   * one page; searched, the match drops rows after the read, so the page is
   * filled across reads like a filtered Scan, its cursor carrying the index keys.
   */
  async findByDepartment(
    department: string,
    limit: number,
    cursor?: string,
    search?: string,
  ): Promise<PaginatedResult> {
    const query = {
      TableName: USERS_TABLE,
      IndexName: GSI2_NAME,
      KeyConditionExpression: 'GSI2PK = :pk',
      ExpressionAttributeValues: { ':pk': `DEPT#${department}` },
    };
    const term = normalizeUserSearch(search);

    if (!term) {
      const result = await this.dynamoDb.client.send(
        new QueryCommand({ ...query, Limit: limit, ExclusiveStartKey: this.decodeCursor(cursor) }),
      );
      return {
        items: (result.Items || []).map(this.toUser),
        nextCursor: this.encodeCursor(result.LastEvaluatedKey),
      };
    }

    return this.fill(
      (input) => this.dynamoDb.client.send(new QueryCommand({ ...query, ...input })),
      limit,
      cursor,
      term,
      (i) => ({ PK: i.PK, SK: i.SK, GSI2PK: i.GSI2PK, GSI2SK: i.GSI2SK }),
    );
  }

  /**
   * One page of user records, filled across reads — the filter (DynamoDB's,
   * and the search on top) drops most of what a read returns — never longer
   * than `limit`, with a cursor on the last row kept.
   */
  private async fill(
    read: RowRead,
    limit: number,
    cursor: string | undefined,
    term: string | undefined,
    keyOf: (item: Row) => Row = (i) => ({ PK: i.PK, SK: i.SK }),
  ): Promise<PaginatedResult> {
    const page = await scanPage<Row>(searched(read, term), limit, {
      startKey: this.decodeCursor(cursor),
      keyOf,
    });
    return {
      items: page.items.map(this.toUser),
      nextCursor: this.encodeCursor(page.lastKey),
    };
  }

  /**
   * The Scan that selects user records — under a status when one is given —
   * shared by the lists and their counts so they answer about the same rows.
   */
  private userScan(status?: UserStatus) {
    return {
      TableName: USERS_TABLE,
      FilterExpression: status
        ? 'begins_with(PK, :pk) AND SK = :sk AND #status = :status'
        : 'begins_with(PK, :pk) AND SK = :sk',
      ExpressionAttributeValues: {
        ':pk': 'USER#',
        ':sk': 'METADATA',
        ...(status && { ':status': status }),
      },
      names: (status ? { '#status': 'status' } : {}) as Record<string, string>,
    };
  }

  /**
   * A count under the search term. `Select: 'COUNT'` cannot apply a match
   * DynamoDB cannot express, so each read brings back the three fields the
   * match needs and the matches are tallied here — the same reads, bounded
   * the same way, as the bodiless count.
   */
  private countSearched(
    send: (input: CountReadInput & { ProjectionExpression: string }) => Promise<ScanReadOutput<Row>>,
    term: string,
  ): Promise<CountRowsResult> {
    return countRows(async (input) => {
      const out = await send({ ...input, ProjectionExpression: SEARCH_PROJECTION.ProjectionExpression });
      return {
        Count: (out.Items ?? []).filter((row) => userMatchesSearch(row, term)).length,
        LastEvaluatedKey: out.LastEvaluatedKey,
      };
    });
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
   * fell back to "Unknown". `search` narrows the page further (see `user-search`).
   */
  async findAll(limit: number, cursor?: string, search?: string): Promise<PaginatedResult> {
    return this.findScanned(undefined, limit, cursor, search);
  }

  async findByStatus(
    status: UserStatus,
    limit: number,
    cursor?: string,
    search?: string,
  ): Promise<PaginatedResult> {
    return this.findScanned(status, limit, cursor, search);
  }

  private findScanned(
    status: UserStatus | undefined,
    limit: number,
    cursor: string | undefined,
    search: string | undefined,
  ): Promise<PaginatedResult> {
    const { names, ...scan } = this.userScan(status);
    return this.fill(
      (input) =>
        this.dynamoDb.client.send(
          new ScanCommand({
            ...scan,
            ...(Object.keys(names).length > 0 && { ExpressionAttributeNames: names }),
            ...input,
          }),
        ),
      limit,
      cursor,
      normalizeUserSearch(search),
    );
  }

  /**
   * How many users the list holds — the number behind "Page 2 of 7".
   *
   * `Select: 'COUNT'` keeps the bodies off the wire, and the walk is bounded:
   * this is a Scan over a table where a technician's job types, service areas,
   * commission rows and profile all sit beside the user records, so counting
   * without a ceiling would read the lot on every page load.
   */
  async countAll(search?: string): Promise<CountRowsResult> {
    return this.countScanned(undefined, search);
  }

  /** The same count under the list's status filter. */
  async countByStatus(status: UserStatus, search?: string): Promise<CountRowsResult> {
    return this.countScanned(status, search);
  }

  private countScanned(status: UserStatus | undefined, search: string | undefined): Promise<CountRowsResult> {
    const { names, ...scan } = this.userScan(status);
    const term = normalizeUserSearch(search);
    if (term) {
      return this.countSearched(
        (input) =>
          this.dynamoDb.client.send(
            new ScanCommand({ ...scan, ExpressionAttributeNames: { ...names, ...SEARCH_PROJECTION.names }, ...input }),
          ),
        term,
      );
    }
    return countRows((input) =>
      this.dynamoDb.client.send(
        new ScanCommand({
          ...scan,
          ...(Object.keys(names).length > 0 && { ExpressionAttributeNames: names }),
          Select: 'COUNT',
          ...input,
        }),
      ),
    );
  }

  /** One department, on the department index — a Query, so the cheap end. */
  async countByDepartment(department: string, search?: string): Promise<CountRowsResult> {
    const query = {
      TableName: USERS_TABLE,
      IndexName: GSI2_NAME,
      KeyConditionExpression: 'GSI2PK = :pk',
      ExpressionAttributeValues: { ':pk': `DEPT#${department}` },
    };
    const term = normalizeUserSearch(search);
    if (term) {
      return this.countSearched(
        (input) =>
          this.dynamoDb.client.send(
            new QueryCommand({ ...query, ExpressionAttributeNames: SEARCH_PROJECTION.names, ...input }),
          ),
        term,
      );
    }
    return countRows((input) =>
      this.dynamoDb.client.send(new QueryCommand({ ...query, Select: 'COUNT', ...input })),
    );
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
