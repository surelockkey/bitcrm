/**
 * Give every product a short sequential `number` ("Product ID").
 *
 * WHY
 * ---
 * `ProductsService.create` takes the number from the COUNTER#PRODUCT row, but
 * the products written before the counter existed — and the Workiz import —
 * carry none. Imported rows take their Workiz item id (`externalId =
 * workiz:item:<n>`), so the number a technician knows from Workiz stays the
 * same; the counter is then moved past the highest number in use and every
 * remaining row draws the next value.
 *
 * Idempotent and upsert-only: a row with a `number` is skipped, the counter is
 * only ever raised, and nothing is removed. Running it twice changes nothing.
 * A row numbered between the scan and its write — an overlapping run, or a
 * product the service created mid-run — is skipped and counted, not fatal
 * (a counter value drawn for it stays unused).
 *
 * Usage:
 *   npm run backfill:product-numbers -w backend/services/inventory
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
import type { DynamoDbService } from '@bitcrm/shared';
import { ProductsRepository } from '../products/products.repository';
import {
  planProductNumbers,
  writeNumberUnlessTaken,
  type ProductNumberRow,
} from '../products/product-number.backfill';

const INVENTORY_TABLE = process.env.INVENTORY_TABLE || 'BitCRM_Inventory';

async function main() {
  const client = DynamoDBDocumentClient.from(
    new DynamoDBClient({
      region: process.env.AWS_REGION || 'us-east-1',
      ...(process.env.DYNAMODB_ENDPOINT && {
        endpoint: process.env.DYNAMODB_ENDPOINT,
        credentials: { accessKeyId: 'local', secretAccessKey: 'local' },
      }),
    }),
  );
  // The counter lives behind the repository so this script and the service
  // can never disagree about the row or the expression.
  const repository = new ProductsRepository({ client } as DynamoDbService);
  console.log(`Table: ${INVENTORY_TABLE}`);

  const rows: ProductNumberRow[] = [];
  let lastKey: Record<string, unknown> | undefined;
  do {
    const page = await client.send(
      new ScanCommand({
        TableName: INVENTORY_TABLE,
        FilterExpression: 'begins_with(PK, :product) AND SK = :meta',
        ExpressionAttributeValues: { ':product': 'PRODUCT#', ':meta': 'METADATA' },
        ProjectionExpression: 'PK, #number, externalId',
        ExpressionAttributeNames: { '#number': 'number' },
        ExclusiveStartKey: lastKey,
      }),
    );
    rows.push(...((page.Items ?? []) as ProductNumberRow[]));
    lastKey = page.LastEvaluatedKey;
  } while (lastKey);

  const plan = planProductNumbers(rows);
  const alreadyNumbered = rows.length - plan.imported.length - plan.pending.length;
  console.log(
    `${rows.length} product row(s): ${alreadyNumbered} numbered, ` +
      `${plan.imported.length} imported, ${plan.pending.length} pending; ceiling ${plan.max}`,
  );

  const setNumber = (PK: string, number: number) =>
    client.send(
      new UpdateCommand({
        TableName: INVENTORY_TABLE,
        Key: { PK, SK: 'METADATA' },
        UpdateExpression: 'SET #number = :n',
        // Never number a row twice, nor resurrect one deleted since the scan.
        ConditionExpression: 'attribute_exists(PK) AND attribute_not_exists(#number)',
        ExpressionAttributeNames: { '#number': 'number' },
        ExpressionAttributeValues: { ':n': number },
      }),
    );

  let skipped = 0;
  const numberRow = async (PK: string, number: number): Promise<boolean> => {
    if ((await writeNumberUnlessTaken(() => setNumber(PK, number))) === 'written') return true;
    skipped += 1;
    console.log(`  - ${PK}: numbered or removed since the scan, skipped`);
    return false;
  };

  let imported = 0;
  for (const { PK, number } of plan.imported) {
    if (await numberRow(PK, number)) imported += 1;
  }

  await repository.raiseCounterTo(plan.max);

  let assigned = 0;
  for (const PK of plan.pending) {
    const number = await repository.nextNumber();
    if (await numberRow(PK, number)) assigned += 1;
  }

  console.log(
    `\n${imported} imported number(s) written, ${assigned} assigned from the counter, ` +
      `${skipped} skipped (numbered or removed since the scan).`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Backfill failed:', err);
    process.exit(1);
  });
