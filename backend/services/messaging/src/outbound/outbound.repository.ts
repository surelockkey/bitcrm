import { Injectable } from '@nestjs/common';
import { UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { DynamoDbService } from '@bitcrm/shared';
import { MESSAGING_TABLE, conversationPk, messageSk } from '../common/constants/dynamo.constants';
import { isConditionalCheckFailed } from '../common/dynamo-errors';
import { type MessageKey } from '../messages/messages.repository';

export interface ProviderAcceptance {
  providerSid: string;
  /** Twilio `NumSegments`. */
  segments?: number;
  /** The number Twilio actually sent from — recorded when the pool chose it. */
  from?: string;
  at?: string;
}

/**
 * The one write the outbound worker needs that the messages repository does
 * not offer: recording that the provider accepted a message. It touches
 * `providerSid`, `segments`, `updatedAt` and — only when the message had
 * none (a pool send) — `from` / `businessNumber`, and deliberately leaves
 * `status` alone: the status walk is `updateStatus`'s rank-guarded job, and
 * a `delivered` callback may already have landed by the time the create
 * call returns. Guarded by `providerSid` absent-or-equal, so a retry that
 * reconciled to the same sid is a no-op and a different sid is refused.
 *
 *   CONV#<conversationId> / MSG#<createdAt>#<messageId>
 */
@Injectable()
export class OutboundRepository {
  private tableName = MESSAGING_TABLE;

  constructor(private readonly dynamoDb: DynamoDbService) {}

  /** `true` when written; `false` when the message is gone or already carries another sid. */
  async attachProviderSid(key: MessageKey, input: ProviderAcceptance): Promise<boolean> {
    const at = input.at ?? new Date().toISOString();
    const sets = ['#providerSid = :sid', '#updatedAt = :at'];
    const names: Record<string, string> = { '#providerSid': 'providerSid', '#updatedAt': 'updatedAt' };
    const values: Record<string, unknown> = { ':sid': input.providerSid, ':at': at };

    if (input.segments !== undefined && Number.isFinite(input.segments)) {
      sets.push('#segments = :segments');
      names['#segments'] = 'segments';
      values[':segments'] = input.segments;
    }
    if (input.from) {
      sets.push('#from = if_not_exists(#from, :from)', '#businessNumber = if_not_exists(#businessNumber, :from)');
      names['#from'] = 'from';
      names['#businessNumber'] = 'businessNumber';
      values[':from'] = input.from;
    }

    try {
      await this.dynamoDb.client.send(
        new UpdateCommand({
          TableName: this.tableName,
          Key: { PK: conversationPk(key.conversationId), SK: messageSk(key.createdAt, key.messageId) },
          UpdateExpression: `SET ${sets.join(', ')}`,
          ConditionExpression: 'attribute_exists(PK) AND (attribute_not_exists(#providerSid) OR #providerSid = :sid)',
          ExpressionAttributeNames: names,
          ExpressionAttributeValues: values,
        }),
      );
      return true;
    } catch (err) {
      if (isConditionalCheckFailed(err)) return false;
      throw err;
    }
  }
}
