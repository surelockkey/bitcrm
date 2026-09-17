import { type CreateTableCommandInput } from '@aws-sdk/client-dynamodb';
import { BILLING_GSIS } from './constants/dynamo.constants';

/**
 * The DynamoDB shape of the billing table, in one place so the local setup
 * script and any test harness cannot drift from each other (the deployed
 * table is Terraform, `infra/dev/data_plane.tf` — keep the three aligned).
 */
export function billingTableDefinition(tableName: string): CreateTableCommandInput {
  return {
    TableName: tableName,
    KeySchema: [
      { AttributeName: 'PK', KeyType: 'HASH' },
      { AttributeName: 'SK', KeyType: 'RANGE' },
    ],
    AttributeDefinitions: [
      { AttributeName: 'PK', AttributeType: 'S' },
      { AttributeName: 'SK', AttributeType: 'S' },
      ...BILLING_GSIS.flatMap(({ n }) => [
        { AttributeName: `GSI${n}PK`, AttributeType: 'S' as const },
        { AttributeName: `GSI${n}SK`, AttributeType: 'S' as const },
      ]),
    ],
    GlobalSecondaryIndexes: BILLING_GSIS.map(({ n, name }) => ({
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
