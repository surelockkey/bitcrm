import { Injectable } from '@nestjs/common';
import { GetCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { DynamoDbService } from '@bitcrm/shared';
import {
  CALLS_TABLE,
  CALLS_GSI1_NAME,
  CALLS_GSI2_NAME,
  ALL_CALLS_PK,
  callPk,
  agentGsiPk,
  allCallsSk,
} from '../common/constants/dynamo.constants';

export type CallStatus =
  | 'queued'
  | 'initiated'
  | 'ringing'
  | 'in-progress'
  | 'completed'
  | 'busy'
  | 'no-answer'
  | 'failed'
  | 'canceled';

/** Statuses that mean the call is still happening (live section of the list). */
export const LIVE_STATUSES: CallStatus[] = [
  'queued',
  'initiated',
  'ringing',
  'in-progress',
];

/** How a system user was involved in a call. */
export type ParticipantRole = 'caller' | 'answered' | 'listened' | 'joined';

export interface CallParticipant {
  userId: string;
  role: ParticipantRole;
  at: string;
  /** Display name, enriched at read time (never stored). */
  name?: string;
  /** Their system role, enriched at read time (never stored). */
  roleId?: string;
}

/** A party matched in the CRM, enriched at read time (never stored). */
export interface CallContactRef {
  kind: 'contact' | 'company';
  id: string;
  name: string;
  companyId?: string;
}

/**
 * One of our own people reached on their personal number — matched by the
 * endpoint, not by softphone participation. Enriched at read time.
 */
export interface CallUserPhoneRef {
  id: string;
  name: string;
  roleId?: string;
}

export interface CallRecord {
  /** Primary sid: outbound = agent leg, inbound = customer leg. */
  callSid: string;
  direction?: 'inbound' | 'outbound';
  /** E.164 on both sides (never `client:…`). */
  from?: string;
  to?: string;
  status?: CallStatus;
  agentId?: string;
  /** Agent display name, enriched at read time (never stored). */
  agentName?: string;
  /** The agent's system role, enriched at read time (never stored). */
  agentRoleId?: string;
  /** CRM contacts behind the two endpoints, enriched at read time. */
  fromContact?: CallContactRef;
  toContact?: CallContactRef;
  /** System users reached on their personal number, enriched at read time. */
  fromPersonal?: CallUserPhoneRef;
  toPersonal?: CallUserPhoneRef;
  /** Talk time (endedAt − answeredAt), seconds. */
  durationSeconds?: number;
  startedAt: string;
  updatedAt: string;
  answeredAt?: string;
  endedAt?: string;
  conferenceName?: string;
  conferenceSid?: string;
  recordingSid?: string;
  recordingDurationSeconds?: number;
  /** Secondary leg sids (customer participant / agent ring legs). */
  childSids?: string[];
  /** System users involved: who called / answered / listened / joined, when. */
  participants?: CallParticipant[];
  /**
   * Set when this record is the receiving side of a call between two of our
   * own numbers — the linked (outbound) record is the one shown in the log.
   */
  internalLegOf?: string;
}

export interface ListCallsFilter {
  status?: string;
  direction?: string;
  agentId?: string;
  /** Substring match against either party's number. */
  number?: string;
  /** Match any of these numbers on either side — a client's whole phone list. */
  numbers?: string[];
  /** ISO (or prefix) lower bound on startedAt. */
  dateFrom?: string;
  /** ISO (or prefix) upper bound on startedAt — inclusive of the whole day. */
  dateTo?: string;
}

export interface ListCallsResult {
  items: CallRecord[];
  nextCursor?: string;
}

/** How far back the live-calls query scans. Live calls are always recent;
 *  anything older with a non-terminal status is a stale record, not a call. */
const LIVE_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Records written before 2026-08-05 never materialized `callSid` as an item
 * attribute (it only lived inside the PK) — hydrate it on read so every
 * consumer (and every React key) has it.
 */
function hydrate(item: Record<string, unknown>): CallRecord {
  const rec = item as unknown as CallRecord;
  if (!rec.callSid) {
    const pk = item.PK as string | undefined;
    if (pk?.startsWith('CALL#')) rec.callSid = pk.slice('CALL#'.length);
  }
  return rec;
}

/** Internal Dynamo page size while filling a filtered page. */
const QUERY_PAGE_SIZE = 100;

@Injectable()
export class CallsRepository {
  private tableName = CALLS_TABLE;

  constructor(private readonly dynamoDb: DynamoDbService) {}

  /**
   * Upsert a call record keyed by its Twilio CallSid. `startedAt` is set only on
   * first write (if_not_exists); every subsequent status callback refreshes the
   * mutable fields. GSI1 (agent history) is written when the agent is known;
   * GSI2 (global time-ordered log) is always written.
   */
  async upsert(rec: CallRecord): Promise<void> {
    const sets: string[] = [
      '#callSid = :callSid',
      '#startedAt = if_not_exists(#startedAt, :startedAt)',
      '#updatedAt = :updatedAt',
      '#gsi2pk = :gsi2pk',
      '#gsi2sk = if_not_exists(#gsi2sk, :gsi2sk)',
    ];
    const names: Record<string, string> = {
      '#callSid': 'callSid',
      '#startedAt': 'startedAt',
      '#updatedAt': 'updatedAt',
      '#gsi2pk': 'GSI2PK',
      '#gsi2sk': 'GSI2SK',
    };
    const values: Record<string, unknown> = {
      ':callSid': rec.callSid,
      ':startedAt': rec.startedAt,
      ':updatedAt': rec.updatedAt,
      ':gsi2pk': ALL_CALLS_PK,
      ':gsi2sk': allCallsSk(rec.startedAt, rec.callSid),
    };

    const optional: Array<[string, unknown]> = [
      ['direction', rec.direction],
      ['from', rec.from],
      ['to', rec.to],
      ['status', rec.status],
      ['agentId', rec.agentId],
      ['durationSeconds', rec.durationSeconds],
      ['answeredAt', rec.answeredAt],
      ['endedAt', rec.endedAt],
      ['conferenceName', rec.conferenceName],
      ['conferenceSid', rec.conferenceSid],
      ['recordingSid', rec.recordingSid],
      ['recordingDurationSeconds', rec.recordingDurationSeconds],
      ['internalLegOf', rec.internalLegOf],
    ];
    for (const [field, value] of optional) {
      // Empty strings guard against Twilio callbacks that report blank
      // fields (e.g. To="" on SDK legs) clobbering real values.
      if (value === undefined || value === null || value === '') continue;
      sets.push(`#${field} = :${field}`);
      names[`#${field}`] = field;
      values[`:${field}`] = value;
    }

    if (rec.agentId) {
      names['#gsi1pk'] = 'GSI1PK';
      names['#gsi1sk'] = 'GSI1SK';
      values[':gsi1pk'] = agentGsiPk(rec.agentId);
      values[':gsi1sk'] = `${rec.startedAt}#${rec.callSid}`;
      sets.push('#gsi1pk = :gsi1pk', '#gsi1sk = if_not_exists(#gsi1sk, :gsi1sk)');
    }

    await this.dynamoDb.client.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: { PK: callPk(rec.callSid), SK: 'METADATA' },
        UpdateExpression: `SET ${sets.join(', ')}`,
        ExpressionAttributeNames: names,
        ExpressionAttributeValues: values,
      }),
    );
  }

  async getBySid(callSid: string): Promise<CallRecord | null> {
    const res = await this.dynamoDb.client.send(
      new GetCommand({
        TableName: this.tableName,
        Key: { PK: callPk(callSid), SK: 'METADATA' },
      }),
    );
    return res.Item ? hydrate(res.Item) : null;
  }

  /** Record a system user's involvement (caller/answered/listened/joined). */
  async appendParticipant(
    callSid: string,
    participant: CallParticipant,
  ): Promise<void> {
    await this.dynamoDb.client.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: { PK: callPk(callSid), SK: 'METADATA' },
        UpdateExpression:
          'SET participants = list_append(if_not_exists(participants, :empty), :p)',
        ExpressionAttributeValues: {
          ':empty': [],
          ':p': [
            {
              userId: participant.userId,
              role: participant.role,
              at: participant.at,
            },
          ],
        },
      }),
    );
  }

  /** Append a secondary leg sid to the record (idempotent per upsert cycle). */
  async appendChildSid(callSid: string, childSid: string): Promise<void> {
    await this.dynamoDb.client.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: { PK: callPk(callSid), SK: 'METADATA' },
        UpdateExpression:
          'SET childSids = list_append(if_not_exists(childSids, :empty), :child)',
        ConditionExpression:
          'attribute_not_exists(childSids) OR NOT contains(childSids, :childSid)',
        ExpressionAttributeValues: {
          ':empty': [],
          ':child': [childSid],
          ':childSid': childSid,
        },
      }),
    ).catch((error: unknown) => {
      // Condition failure = the sid is already recorded; that's fine.
      if (
        error instanceof Error &&
        error.name === 'ConditionalCheckFailedException'
      ) {
        return;
      }
      throw error;
    });
  }

  /**
   * Global call log, newest first, with in-service filtering (the GSI keys give
   * time ordering; status/direction/agent/number narrow via FilterExpression,
   * looping internal pages until `limit` items are collected — the same shape
   * as the CRM work-orders registry listing).
   */
  async list(
    filter: ListCallsFilter,
    cursor: string | undefined,
    limit: number,
  ): Promise<ListCallsResult> {
    const { keyCondition, filterExpression, names, values } =
      this.buildListQuery(filter);

    const items: CallRecord[] = [];
    let exclusiveStartKey = this.decodeCursor(cursor);

    for (;;) {
      const res = await this.dynamoDb.client.send(
        new QueryCommand({
          TableName: this.tableName,
          IndexName: CALLS_GSI2_NAME,
          KeyConditionExpression: keyCondition,
          ...(filterExpression && { FilterExpression: filterExpression }),
          ...(Object.keys(names).length && { ExpressionAttributeNames: names }),
          ExpressionAttributeValues: values,
          ScanIndexForward: false,
          Limit: QUERY_PAGE_SIZE,
          ...(exclusiveStartKey && { ExclusiveStartKey: exclusiveStartKey }),
        }),
      );

      const page = (res.Items ?? []).map(hydrate);
      const room = limit - items.length;
      items.push(...page.slice(0, room));
      const truncatedMidPage = page.length > room;
      const lastEvaluatedKey = res.LastEvaluatedKey;

      if (items.length >= limit) {
        // When we cut a page short, resume from the last item actually
        // returned (not LastEvaluatedKey) so the remainder isn't skipped.
        const resumeKey = truncatedMidPage
          ? this.keyOf(items[items.length - 1])
          : lastEvaluatedKey;
        return { items, nextCursor: this.encodeCursor(resumeKey) };
      }
      if (!lastEvaluatedKey) return { items };
      exclusiveStartKey = lastEvaluatedKey;
    }
  }

  /** Live (non-terminal) calls in the recent window, newest first. */
  async listLive(now: number = Date.now()): Promise<CallRecord[]> {
    const skFrom = new Date(now - LIVE_WINDOW_MS).toISOString();
    const values: Record<string, unknown> = {
      ':allPk': ALL_CALLS_PK,
      ':skFrom': skFrom,
    };
    const statusKeys = LIVE_STATUSES.map((s, i) => {
      values[`:live${i}`] = s;
      return `:live${i}`;
    });

    const res = await this.dynamoDb.client.send(
      new QueryCommand({
        TableName: this.tableName,
        IndexName: CALLS_GSI2_NAME,
        KeyConditionExpression: 'GSI2PK = :allPk AND GSI2SK >= :skFrom',
        FilterExpression: `#status IN (${statusKeys.join(', ')}) AND attribute_not_exists(internalLegOf)`,
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: values,
        ScanIndexForward: false,
      }),
    );
    return (res.Items ?? []).map(hydrate);
  }

  /** An agent's recent calls, newest first. */
  async listByAgent(agentId: string, limit = 25): Promise<CallRecord[]> {
    const res = await this.dynamoDb.client.send(
      new QueryCommand({
        TableName: this.tableName,
        IndexName: CALLS_GSI1_NAME,
        KeyConditionExpression: 'GSI1PK = :pk',
        ExpressionAttributeValues: { ':pk': agentGsiPk(agentId) },
        ScanIndexForward: false,
        Limit: limit,
      }),
    );
    return (res.Items ?? []).map(hydrate);
  }

  /* ------------------------------------------------------------------ */

  private buildListQuery(filter: ListCallsFilter): {
    keyCondition: string;
    filterExpression?: string;
    names: Record<string, string>;
    values: Record<string, unknown>;
  } {
    const names: Record<string, string> = {};
    const values: Record<string, unknown> = { ':allPk': ALL_CALLS_PK };

    let keyCondition = 'GSI2PK = :allPk';
    if (filter.dateFrom && filter.dateTo) {
      keyCondition += ' AND GSI2SK BETWEEN :skFrom AND :skTo';
      values[':skFrom'] = filter.dateFrom;
      // '￿' sorts after any startedAt#sid suffix → inclusive upper bound.
      values[':skTo'] = `${filter.dateTo}￿`;
    } else if (filter.dateFrom) {
      keyCondition += ' AND GSI2SK >= :skFrom';
      values[':skFrom'] = filter.dateFrom;
    } else if (filter.dateTo) {
      keyCondition += ' AND GSI2SK <= :skTo';
      values[':skTo'] = `${filter.dateTo}￿`;
    }

    // The receiving side of an internal (our-number-to-our-number) call is
    // bookkeeping, not a call of its own — never listed.
    const clauses: string[] = ['attribute_not_exists(internalLegOf)'];
    if (filter.status) {
      clauses.push('#status = :status');
      names['#status'] = 'status';
      values[':status'] = filter.status;
    }
    if (filter.direction) {
      clauses.push('#direction = :direction');
      names['#direction'] = 'direction';
      values[':direction'] = filter.direction;
    }
    if (filter.agentId) {
      clauses.push('agentId = :agentId');
      values[':agentId'] = filter.agentId;
    }
    if (filter.number) {
      clauses.push('(contains(#from, :number) OR contains(#to, :number))');
      names['#from'] = 'from';
      names['#to'] = 'to';
      values[':number'] = filter.number;
    }
    if (filter.numbers?.length) {
      // A contact owns several numbers and may appear on either side of a
      // call — OR every combination rather than issuing one query per number.
      const ors = filter.numbers.map((num, i) => {
        values[`:num${i}`] = num;
        return `contains(#from, :num${i}) OR contains(#to, :num${i})`;
      });
      clauses.push(`(${ors.join(' OR ')})`);
      names['#from'] = 'from';
      names['#to'] = 'to';
    }

    return {
      keyCondition,
      filterExpression: clauses.length ? clauses.join(' AND ') : undefined,
      names,
      values,
    };
  }

  /** The GSI2 resume key for a returned record (all index + table keys). */
  private keyOf(rec: CallRecord): Record<string, unknown> {
    return {
      PK: callPk(rec.callSid),
      SK: 'METADATA',
      GSI2PK: ALL_CALLS_PK,
      GSI2SK: allCallsSk(rec.startedAt, rec.callSid),
    };
  }

  private encodeCursor(
    lastEvaluatedKey?: Record<string, unknown>,
  ): string | undefined {
    if (!lastEvaluatedKey) return undefined;
    return Buffer.from(JSON.stringify(lastEvaluatedKey)).toString('base64url');
  }

  private decodeCursor(cursor?: string): Record<string, unknown> | undefined {
    if (!cursor) return undefined;
    return JSON.parse(Buffer.from(cursor, 'base64url').toString('utf-8'));
  }
}
