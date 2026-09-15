import { Injectable } from '@nestjs/common';
import { UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { DynamoDbService } from '@bitcrm/shared';
import { MESSAGING_TABLE, conversationPk, messageSk } from '../common/constants/dynamo.constants';
import { isConditionalCheckFailed } from '../common/dynamo-errors';
import { type MessageKey } from '../messages/messages.repository';

export interface SesAcceptance {
  /** The SES message id. */
  providerSid: string;
  /** `<sesId@email.amazonses.com>` — the `Message-ID` SES stamped, for threading replies. */
  emailMessageId: string;
  /** Recorded only when the message had none (the worker resolved the sender late). */
  from?: string;
  at?: string;
}

/**
 * The email counterpart of `OutboundRepository.attachProviderSid`: once SES
 * accepted a message, record its id twice — as `providerSid` (what events
 * carry) and as `emailMessageId` (what a client's `In-Reply-To` carries) —
 * plus `from` when the worker chose it. `status` is deliberately untouched:
 * the rank-guarded `updateStatus` walks it. Guarded by `providerSid`
 * absent-or-equal, so a redelivered job is a no-op and a different id is refused.
 *
 *   CONV#<conversationId> / MSG#<createdAt>#<messageId>
 */
@Injectable()
export class EmailMessagesRepository {
  private tableName = MESSAGING_TABLE;

  constructor(private readonly dynamoDb: DynamoDbService) {}

  async attachSesMessageId(key: MessageKey, input: SesAcceptance): Promise<boolean> {
    const at = input.at ?? new Date().toISOString();
    const sets = ['#providerSid = :sid', '#emailMessageId = :emailMessageId', '#updatedAt = :at'];
    const names: Record<string, string> = {
      '#providerSid': 'providerSid',
      '#emailMessageId': 'emailMessageId',
      '#updatedAt': 'updatedAt',
    };
    const values: Record<string, unknown> = { ':sid': input.providerSid, ':emailMessageId': input.emailMessageId, ':at': at };
    if (input.from) {
      sets.push('#from = if_not_exists(#from, :from)');
      names['#from'] = 'from';
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
