/**
 * Migrate deals from the single-tech model to the multi-tech model:
 *   - legacy scalar `assignedTechId` → `assignedTechIds: [id]`
 *   - legacy scalar `sequenceNumber` → `sequences: { [id]: sequenceNumber }`
 *   - write the assignment adjacency row `SK=ASSIGN#<techId>` (tech index GSI2)
 *   - strip the old `assignedTechId` / `sequenceNumber` / metadata `GSI2PK`/`GSI2SK`
 *
 * Idempotent: a deal that already has `assignedTechIds` and no legacy
 * `assignedTechId` is skipped. Run in the same window as the deploy — before it,
 * `findByTech` (which now reads assignment rows) returns nothing for a tech.
 *
 * Usage:
 *   ts-node src/scripts/migrate-deal-assignments.ts            # apply
 *   ts-node src/scripts/migrate-deal-assignments.ts --dry-run  # preview only
 */
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(__dirname, '../../../../.env') });

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  ScanCommand,
  PutCommand,
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
  let migrated = 0;
  let skipped = 0;
  let lastKey: Record<string, unknown> | undefined;

  do {
    const page = await client.send(
      new ScanCommand({
        TableName: TABLE,
        FilterExpression: 'begins_with(PK, :deal) AND SK = :meta',
        ExpressionAttributeValues: { ':deal': 'DEAL#', ':meta': 'METADATA' },
        ExclusiveStartKey: lastKey,
      }),
    );

    for (const item of page.Items ?? []) {
      const dealId = item.id as string;
      // Already migrated (has the array and no legacy scalar).
      if (Array.isArray(item.assignedTechIds) && item.assignedTechId === undefined) {
        skipped++;
        continue;
      }

      const techId = item.assignedTechId as string | undefined;
      const seq = item.sequenceNumber as number | undefined;
      const assignedTechIds = techId ? [techId] : [];
      const sequences = techId ? { [techId]: seq ?? 1 } : {};
      const scheduledDate = (item.scheduledDate as string | undefined) ?? undefined;

      console.log(`deal ${dealId}: assignedTechId=${techId ?? '—'} → assignedTechIds=[${assignedTechIds.join(', ')}]`);

      if (!DRY_RUN) {
        // Assignment adjacency row (tech index) for the legacy tech, if any.
        if (techId) {
          await client.send(
            new PutCommand({
              TableName: TABLE,
              Item: {
                PK: `DEAL#${dealId}`,
                SK: `ASSIGN#${techId}`,
                GSI2PK: `TECH#${techId}`,
                GSI2SK: `${scheduledDate || (item.createdAt as string)}#DEAL#${dealId}`,
                dealId,
                techId,
                assignedBy: 'migration',
                assignedAt: new Date().toISOString(),
                scheduledDate,
              },
            }),
          );
        }

        await client.send(
          new UpdateCommand({
            TableName: TABLE,
            Key: { PK: `DEAL#${dealId}`, SK: 'METADATA' },
            UpdateExpression:
              'SET assignedTechIds = :ids, sequences = :seqs ' +
              'REMOVE assignedTechId, sequenceNumber, GSI2PK, GSI2SK',
            ExpressionAttributeValues: { ':ids': assignedTechIds, ':seqs': sequences },
          }),
        );
      }
      migrated++;
    }
    lastKey = page.LastEvaluatedKey;
  } while (lastKey);

  console.log(`\nMigrated ${migrated} deal(s), skipped ${skipped} already-migrated${DRY_RUN ? ' (dry-run)' : ''}.`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('migrate-deal-assignments failed:', err);
    process.exit(1);
  });
