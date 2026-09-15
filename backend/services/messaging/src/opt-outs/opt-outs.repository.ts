import { Injectable, Logger } from '@nestjs/common';
import { DeleteCommand, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { DynamoDbService } from '@bitcrm/shared';
import {
  OPT_OUT_HISTORY_LIMIT,
  type OptOut,
  type OptOutChannel,
  type OptOutHistoryEntry,
  type OptOutSource,
  type OptOutStatus,
} from '@bitcrm/types';
import { MESSAGING_TABLE, METADATA_SK, optOutPk } from '../common/constants/dynamo.constants';
import { isConditionalCheckFailed } from '../common/dynamo-errors';
import { compact, stripKeys } from '../common/items';

export interface SetOptOutInput {
  channel: OptOutChannel;
  /** E.164 or lowercase email — normalised by the caller. */
  address: string;
  status: OptOutStatus;
  source: OptOutSource;
  keyword?: string;
  messagingServiceSid?: string;
  by?: string;
  at?: string;
}

const MAX_ATTEMPTS = 3;

/**
 * `OPTOUT#<sms|email>#<address>` / `METADATA` — BitCRM's own STOP/START
 * ledger (design §3.2, §4.7). Read before every send (A12). Keys are
 * spread over addresses, so there is no hot partition. Status changes are a
 * read → conditional Put so the bounded `history` list never loses an entry
 * to a concurrent write (Twilio keyword and a manual edit landing together).
 */
@Injectable()
export class OptOutsRepository {
  private readonly logger = new Logger(OptOutsRepository.name);
  private tableName = MESSAGING_TABLE;

  constructor(private readonly dynamoDb: DynamoDbService) {}

  /** `GetItem OPTOUT#<channel>#<address>`. */
  async get(channel: OptOutChannel, address: string): Promise<OptOut | null> {
    const res = await this.dynamoDb.client.send(
      new GetCommand({
        TableName: this.tableName,
        Key: { PK: optOutPk(channel, address), SK: METADATA_SK },
      }),
    );
    return res.Item ? this.toEntity(res.Item) : null;
  }

  /** A12: the pre-send check. Absent row → not opted out. */
  async isOptedOut(channel: OptOutChannel, address: string): Promise<boolean> {
    const row = await this.get(channel, address);
    return row?.status === 'opted_out';
  }

  /**
   * Flip (or reaffirm) the status: `Put` of the whole row with the new
   * entry prepended to `history` (capped at OPT_OUT_HISTORY_LIMIT), guarded by
   * `attribute_not_exists(PK)` for a first write or `updatedAt = <as read>`
   * otherwise; a lost race re-reads and retries.
   */
  async setStatus(input: SetOptOutInput): Promise<OptOut> {
    const at = input.at ?? new Date().toISOString();
    const entry: OptOutHistoryEntry = {
      status: input.status,
      source: input.source,
      keyword: input.keyword,
      at,
      by: input.by,
    };

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const current = await this.get(input.channel, input.address);
      const next: OptOut = {
        channel: input.channel,
        address: input.address,
        status: input.status,
        keyword: input.keyword,
        source: input.source,
        messagingServiceSid: input.messagingServiceSid ?? current?.messagingServiceSid,
        updatedAt: at,
        updatedBy: input.by,
        history: [entry, ...(current?.history ?? [])].slice(0, OPT_OUT_HISTORY_LIMIT),
      };
      try {
        await this.dynamoDb.client.send(
          new PutCommand({
            TableName: this.tableName,
            Item: this.item(next),
            ConditionExpression: current ? '#updatedAt = :expected' : 'attribute_not_exists(PK)',
            ...(current
              ? {
                  ExpressionAttributeNames: { '#updatedAt': 'updatedAt' },
                  ExpressionAttributeValues: { ':expected': current.updatedAt },
                }
              : {}),
          }),
        );
        this.logger.log(`${input.channel} ${input.status} for ${input.address} (${input.source})`);
        return next;
      } catch (err) {
        if (isConditionalCheckFailed(err) && attempt < MAX_ATTEMPTS) continue;
        throw err;
      }
    }
    throw new Error(`Opt-out for ${input.channel}#${input.address} kept changing; giving up`);
  }

  /** Unconditional `Put` — the Workiz import and administrative repairs. */
  async put(optOut: OptOut): Promise<void> {
    await this.dynamoDb.client.send(
      new PutCommand({ TableName: this.tableName, Item: this.item(optOut) }),
    );
  }

  /** `Delete OPTOUT#<channel>#<address>` — administrative only; prefer `opted_in`. */
  async remove(channel: OptOutChannel, address: string): Promise<void> {
    await this.dynamoDb.client.send(
      new DeleteCommand({
        TableName: this.tableName,
        Key: { PK: optOutPk(channel, address), SK: METADATA_SK },
      }),
    );
  }

  private item(optOut: OptOut): Record<string, unknown> {
    return {
      PK: optOutPk(optOut.channel, optOut.address),
      SK: METADATA_SK,
      ...compact(optOut as unknown as Record<string, unknown>),
      history: optOut.history.map((h) => compact(h as unknown as Record<string, unknown>)),
    };
  }

  private toEntity(item: Record<string, unknown>): OptOut {
    const row = stripKeys<OptOut>(item);
    return { ...row, history: row.history ?? [] };
  }
}
