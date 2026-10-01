import { Injectable } from '@nestjs/common';
import { PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { DynamoDbService } from '@bitcrm/shared';
import type { DocumentSignature, SignatureDocumentKind } from '@bitcrm/types';
import { BILLING_TABLE, signaturePk, signatureSk, stripKeys } from '../common/constants/dynamo.constants';

/**
 * Signatures, keyed by the document they sit on (not under the document's
 * own PK, whose rows are its lines):
 *
 *   PK = SIGNATURE#<kind>#<documentId>, SK = <signedAt>#<signatureId>
 */
@Injectable()
export class SignaturesRepository {
  constructor(private readonly db: DynamoDbService) {}

  async put(sig: DocumentSignature): Promise<void> {
    await this.db.client.send(
      new PutCommand({
        TableName: BILLING_TABLE,
        Item: {
          PK: signaturePk(sig.kind, sig.documentId),
          SK: signatureSk(sig.signedAt, sig.id),
          entityType: 'document_signature',
          ...sig,
        },
        ConditionExpression: 'attribute_not_exists(PK)',
      }),
    );
  }

  /** Oldest first. */
  async list(kind: SignatureDocumentKind, documentId: string): Promise<DocumentSignature[]> {
    const rows: DocumentSignature[] = [];
    let ExclusiveStartKey: Record<string, unknown> | undefined;
    do {
      const res = await this.db.client.send(
        new QueryCommand({
          TableName: BILLING_TABLE,
          KeyConditionExpression: 'PK = :pk',
          ExpressionAttributeValues: { ':pk': signaturePk(kind, documentId) },
          ExclusiveStartKey,
        }),
      );
      rows.push(...(res.Items ?? []).map((r) => stripKeys<DocumentSignature>(r)!));
      ExclusiveStartKey = res.LastEvaluatedKey;
    } while (ExclusiveStartKey);
    return rows;
  }
}
