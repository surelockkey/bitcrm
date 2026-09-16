import { Injectable } from '@nestjs/common';
import { DeleteCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { DynamoDbService } from '@bitcrm/shared';
import { type ConversationPointer, type ConversationPointerKind } from '@bitcrm/types';
import { MESSAGING_TABLE, METADATA_SK, convOfPk } from '../common/constants/dynamo.constants';
import { isConditionalCheckFailed } from '../common/dynamo-errors';

/**
 * The party → conversation pointer as a merge sees it (design §3.2, §7.3):
 *
 *   CONVOF#<kind>#<partyId> / METADATA   { pointerKind, pointerId, conversationId, createdAt }
 *
 * `ConversationsRepository.findOrCreate` writes these with
 * `attribute_not_exists(PK)`; a contact merge is the one flow that has to
 * move one — re-point the survivor at the duplicate's thread and drop the
 * duplicate's key. Both writes are conditional on the conversation they
 * expect, so a handler replayed by SQS (or racing a first message to the
 * survivor) never overwrites a pointer somebody else just created.
 */
@Injectable()
export class ContactPointersRepository {
  private tableName = MESSAGING_TABLE;

  constructor(private readonly dynamoDb: DynamoDbService) {}

  /**
   * `Put CONVOF#<kind>#<id>` → `conversationId`, only when the key is absent
   * or already points there. `false` = another conversation owns the party
   * now; the caller re-reads and merges into that one instead.
   */
  async putPartyPointer(
    kind: ConversationPointerKind,
    id: string,
    conversationId: string,
    createdAt: string,
  ): Promise<boolean> {
    const pointer: ConversationPointer = { pointerKind: kind, pointerId: id, conversationId, createdAt };
    try {
      await this.dynamoDb.client.send(
        new PutCommand({
          TableName: this.tableName,
          Item: { PK: convOfPk(kind, id), SK: METADATA_SK, ...pointer },
          ConditionExpression: 'attribute_not_exists(PK) OR conversationId = :cid',
          ExpressionAttributeValues: { ':cid': conversationId },
        }),
      );
      return true;
    } catch (err) {
      if (isConditionalCheckFailed(err)) return false;
      throw err;
    }
  }

  /**
   * `Delete CONVOF#<kind>#<id>` only while it still points at
   * `expectedConversationId`. `false` = already gone or re-pointed — both
   * mean there is nothing left to do.
   */
  async removePartyPointer(
    kind: ConversationPointerKind,
    id: string,
    expectedConversationId: string,
  ): Promise<boolean> {
    try {
      await this.dynamoDb.client.send(
        new DeleteCommand({
          TableName: this.tableName,
          Key: { PK: convOfPk(kind, id), SK: METADATA_SK },
          ConditionExpression: 'conversationId = :cid',
          ExpressionAttributeValues: { ':cid': expectedConversationId },
        }),
      );
      return true;
    } catch (err) {
      if (isConditionalCheckFailed(err)) return false;
      throw err;
    }
  }
}
