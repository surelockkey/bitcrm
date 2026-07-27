/**
 * Migration/backfill: stamp `fulfillment='sourced'` on deal line items written
 * before the field existed. The same self-heal runs automatically on boot
 * (`DealProductsBackfill`); this script is for running it manually / previewing.
 *
 * Idempotent: only rows missing `fulfillment` are touched. `sourced` is the
 * correct default — it is the only kind of line that existed before the field.
 *
 * Usage:
 *   ts-node src/scripts/backfill-deal-product-fulfillment.ts            # apply
 *   ts-node src/scripts/backfill-deal-product-fulfillment.ts --dry-run  # preview only
 */
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(__dirname, '../../../../.env') });

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  ScanCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';

const TABLE = process.env.DEALS_TABLE || 'BitCRM_Deals';
const DRY_RUN = process.argv.includes('--dry-run');

const client = DynamoDBDocumentClient.from(
  new DynamoDBClient({
    region: process.env.AWS_REGION || 'us-east-1',
    ...(process.env.DYNAMODB_ENDPOINT && {
      endpoint: process.env.DYNAMODB_ENDPOINT,
      credentials: { accessKeyId: 'local', secretAccessKey: 'local' },
    }),
  }),
  { marshallOptions: { removeUndefinedValues: true } },
);

async function main(): Promise<void> {
  let stamped = 0;
  let lastKey: Record<string, unknown> | undefined;

  do {
    const page = await client.send(
      new ScanCommand({
        TableName: TABLE,
        FilterExpression:
          'begins_with(SK, :sk) AND attribute_not_exists(fulfillment)',
        ExpressionAttributeValues: { ':sk': 'PRODUCT#' },
        ExclusiveStartKey: lastKey,
      }),
    );

    for (const item of page.Items ?? []) {
      const dealId = (item.PK as string).replace('DEAL#', '');
      const productId = item.productId as string;
      console.log(`deal ${dealId} / product ${productId}: fulfillment → sourced`);

      if (!DRY_RUN) {
        await client.send(
          new UpdateCommand({
            TableName: TABLE,
            Key: { PK: item.PK, SK: item.SK },
            UpdateExpression: 'SET fulfillment = :f',
            ExpressionAttributeValues: { ':f': 'sourced' },
            ConditionExpression: 'attribute_exists(PK)',
          }),
        );
      }
      stamped++;
    }
    lastKey = page.LastEvaluatedKey;
  } while (lastKey);

  console.log(
    `\nStamped ${stamped} deal line item(s)${DRY_RUN ? ' (dry-run)' : ''}.`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('backfill-deal-product-fulfillment failed:', err);
    process.exit(1);
  });
