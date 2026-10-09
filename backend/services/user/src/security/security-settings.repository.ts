import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { GetCommand, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { DynamoDbService } from '@bitcrm/shared';
import { DEFAULT_SECURITY_SETTINGS, type SecuritySettings, type SecuritySettingsAuditEntry } from '@bitcrm/types';
import { USERS_TABLE } from '../users/constants/dynamo.constants';
import { SECURITY_AUDIT_PK, SECURITY_SETTINGS_PK, SECURITY_SETTINGS_SK } from './security.constants';

type Switches = Pick<SecuritySettings, 'requireMfa' | 'loginCodeByEmail' | 'otpByEmail'>;

/**
 * The account's security settings — Workiz's Security Center — in the users
 * table, beside the people they apply to.
 *
 *   SETTINGS / SECURITY                      the one row: the three switches, who saved them
 *   AUDIT#SECURITY_SETTINGS / <ISO>#<uuid>   one line per change: actor, before, after
 *
 * Neither carries GSI keys, and the users listing filters on
 * `begins_with(PK, 'USER#')`, so the rows never surface as people.
 */
@Injectable()
export class SecuritySettingsRepository {
  constructor(private readonly dynamoDb: DynamoDbService) {}

  /** The row, or the defaults — nothing required, nothing by email — until it is saved. */
  async get(): Promise<SecuritySettings> {
    const result = await this.dynamoDb.client.send(
      new GetCommand({
        TableName: USERS_TABLE,
        Key: { PK: SECURITY_SETTINGS_PK, SK: SECURITY_SETTINGS_SK },
      }),
    );
    if (!result.Item) return { ...DEFAULT_SECURITY_SETTINGS };
    const item = result.Item;
    return {
      ...switchesOf(item),
      ...(typeof item.updatedAt === 'string' && { updatedAt: item.updatedAt }),
      ...(typeof item.updatedBy === 'string' && { updatedBy: item.updatedBy }),
    };
  }

  async put(settings: SecuritySettings): Promise<void> {
    await this.dynamoDb.client.send(
      new PutCommand({
        TableName: USERS_TABLE,
        Item: { PK: SECURITY_SETTINGS_PK, SK: SECURITY_SETTINGS_SK, ...settings },
      }),
    );
  }

  async recordChange(entry: SecuritySettingsAuditEntry): Promise<void> {
    await this.dynamoDb.client.send(
      new PutCommand({
        TableName: USERS_TABLE,
        Item: { PK: SECURITY_AUDIT_PK, SK: `${entry.timestamp}#${randomUUID()}`, ...entry },
      }),
    );
  }

  /** The log, newest first. */
  async listChanges(limit = 50): Promise<SecuritySettingsAuditEntry[]> {
    const result = await this.dynamoDb.client.send(
      new QueryCommand({
        TableName: USERS_TABLE,
        KeyConditionExpression: 'PK = :pk',
        ExpressionAttributeValues: { ':pk': SECURITY_AUDIT_PK },
        ScanIndexForward: false,
        Limit: limit,
      }),
    );
    return (result.Items || []).map((item) => ({
      actorId: item.actorId as string,
      timestamp: item.timestamp as string,
      before: switchesOf((item.before as Record<string, unknown>) || {}),
      after: switchesOf((item.after as Record<string, unknown>) || {}),
    }));
  }
}

function switchesOf(item: Record<string, unknown>): Switches {
  return {
    requireMfa: item.requireMfa === true,
    loginCodeByEmail: item.loginCodeByEmail === true,
    otpByEmail: item.otpByEmail === true,
  };
}
