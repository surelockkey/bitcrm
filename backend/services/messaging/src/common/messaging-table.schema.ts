import {
  type CreateTableCommandInput,
  type UpdateTimeToLiveCommandInput,
} from '@aws-sdk/client-dynamodb';
import { MESSAGING_GSIS, MESSAGING_TTL_ATTRIBUTE } from './constants/dynamo.constants';

/**
 * The DynamoDB shape of the messaging table, in one place so the local setup
 * script and the integration-test harness cannot drift from each other (the
 * deployed table is Terraform, `infra/dev/data_plane.tf`, from the same
 * design §3.1 — keep the three aligned).
 */
export function messagingTableDefinition(tableName: string): CreateTableCommandInput {
  return {
    TableName: tableName,
    KeySchema: [
      { AttributeName: 'PK', KeyType: 'HASH' },
      { AttributeName: 'SK', KeyType: 'RANGE' },
    ],
    AttributeDefinitions: [
      { AttributeName: 'PK', AttributeType: 'S' },
      { AttributeName: 'SK', AttributeType: 'S' },
      ...MESSAGING_GSIS.flatMap(({ n }) => [
        { AttributeName: `GSI${n}PK`, AttributeType: 'S' as const },
        { AttributeName: `GSI${n}SK`, AttributeType: 'S' as const },
      ]),
    ],
    GlobalSecondaryIndexes: MESSAGING_GSIS.map(({ n, name }) => ({
      IndexName: name,
      KeySchema: [
        { AttributeName: `GSI${n}PK`, KeyType: 'HASH' },
        { AttributeName: `GSI${n}SK`, KeyType: 'RANGE' },
      ],
      Projection: { ProjectionType: 'ALL' },
    })),
    BillingMode: 'PAY_PER_REQUEST',
  };
}

/** TTL on `expiresAt` — the first use of TTL in BitCRM, for service pointers only. */
export function messagingTableTtl(tableName: string): UpdateTimeToLiveCommandInput {
  return {
    TableName: tableName,
    TimeToLiveSpecification: { AttributeName: MESSAGING_TTL_ATTRIBUTE, Enabled: true },
  };
}
