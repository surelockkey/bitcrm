/**
 * One-off (Revision 2): move taxes from the removed tax-rate catalog onto the
 * service areas themselves.
 *
 * For every service area that still carries the legacy `defaultTaxRateId`:
 *   - copies that catalog rate's name and effective percent into `area.tax`
 *     (unless the area already has a `tax` — then it is left as is);
 *   - removes `defaultTaxRateId`.
 * With `--delete-catalog`, also deletes every `TAX_RATE#` row.
 *
 * Jobs are NOT touched: a job whose `taxRateId` pointed at a catalog rate keeps
 * its snapshot (`taxRateName`/`taxRatePercent`), which is all totals use.
 *
 * Idempotent: an update is conditional on the pointer still being there and
 * never overwrites an existing `tax` (`if_not_exists`); a re-run finds nothing.
 * Uses UpdateCommand (not a full Put), so no other area attribute can be lost.
 *
 * Usage (from backend/services/deal):
 *   npm run backfill:area-taxes -- --dry-run            # preview
 *   npm run backfill:area-taxes                         # apply
 *   npm run backfill:area-taxes -- --delete-catalog     # apply + drop TAX_RATE# rows
 */
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(__dirname, '../../../../.env') });

import { DynamoDBClient, ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  DeleteCommand,
  QueryCommand,
  ScanCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { planAreaTaxBackfill } from '../service-areas/area-tax-backfill';

const TABLE = process.env.DEALS_TABLE || 'BitCRM_Deals';
const GSI1 = 'StageIndex';
const DRY_RUN = process.argv.includes('--dry-run');
const DELETE_CATALOG = process.argv.includes('--delete-catalog');

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

async function queryCatalog(pk: string): Promise<Record<string, unknown>[]> {
  const out: Record<string, unknown>[] = [];
  let lastKey: Record<string, unknown> | undefined;
  do {
    const page = await client.send(
      new QueryCommand({
        TableName: TABLE,
        IndexName: GSI1,
        KeyConditionExpression: 'GSI1PK = :pk',
        ExpressionAttributeValues: { ':pk': pk },
        ExclusiveStartKey: lastKey,
      }),
    );
    out.push(...(page.Items ?? []));
    lastKey = page.LastEvaluatedKey;
  } while (lastKey);
  return out;
}

/** Catalog rows written without the GSI (defensive): a filtered scan. */
async function scanTaxRates(): Promise<Record<string, unknown>[]> {
  const out: Record<string, unknown>[] = [];
  let lastKey: Record<string, unknown> | undefined;
  do {
    const page = await client.send(
      new ScanCommand({
        TableName: TABLE,
        FilterExpression: 'begins_with(PK, :pk)',
        ExpressionAttributeValues: { ':pk': 'TAX_RATE#' },
        ExclusiveStartKey: lastKey,
      }),
    );
    out.push(...(page.Items ?? []));
    lastKey = page.LastEvaluatedKey;
  } while (lastKey);
  return out;
}

async function main(): Promise<void> {
  console.log(
    `Table ${TABLE}${process.env.DYNAMODB_ENDPOINT ? ` @ ${process.env.DYNAMODB_ENDPOINT}` : ' (AWS)'}` +
      `${DRY_RUN ? ' — DRY RUN' : ''}${DELETE_CATALOG ? ' — deleting catalog' : ''}\n`,
  );

  const areas = await queryCatalog('CATALOG#SERVICE_AREA');
  const rates = await scanTaxRates();
  const plan = planAreaTaxBackfill(areas, rates);

  for (const w of plan.warnings) console.warn(`! ${w}`);

  let updated = 0;
  for (const u of plan.areaUpdates) {
    console.log(
      `${u.areaName} (${u.areaId}): ` +
        (u.tax ? `tax ← "${u.tax.name}" ${u.tax.ratePercent}%` : 'keep tax') +
        ', remove defaultTaxRateId',
    );
    if (DRY_RUN) continue;
    try {
      await client.send(
        new UpdateCommand({
          TableName: TABLE,
          Key: { PK: `SERVICE_AREA#${u.areaId}`, SK: 'METADATA' },
          UpdateExpression: u.tax
            ? 'SET #tax = if_not_exists(#tax, :tax), #updatedAt = :now REMOVE #ptr'
            : 'SET #updatedAt = :now REMOVE #ptr',
          ConditionExpression: 'attribute_exists(PK) AND attribute_exists(#ptr)',
          ExpressionAttributeNames: {
            '#ptr': 'defaultTaxRateId',
            '#updatedAt': 'updatedAt',
            ...(u.tax && { '#tax': 'tax' }),
          },
          ExpressionAttributeValues: {
            ':now': new Date().toISOString(),
            ...(u.tax && { ':tax': u.tax }),
          },
        }),
      );
      updated++;
    } catch (err) {
      if (err instanceof ConditionalCheckFailedException) {
        console.log('  (already migrated — skipped)');
        continue;
      }
      throw err;
    }
  }

  let deleted = 0;
  if (DELETE_CATALOG) {
    for (const key of plan.catalogKeys) {
      console.log(`delete ${key.PK}`);
      if (!DRY_RUN) {
        await client.send(new DeleteCommand({ TableName: TABLE, Key: key }));
        deleted++;
      }
    }
  } else if (plan.catalogKeys.length) {
    console.log(`\n${plan.catalogKeys.length} TAX_RATE# row(s) left in place (pass --delete-catalog to remove).`);
  }

  console.log(
    `\nAreas checked: ${areas.length}; areas migrated: ${DRY_RUN ? `${plan.areaUpdates.length} (dry-run)` : updated}; ` +
      `catalog rows deleted: ${DRY_RUN ? `0 (dry-run, ${DELETE_CATALOG ? plan.catalogKeys.length : 0} planned)` : deleted}.`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('backfill-area-taxes failed:', err);
    process.exit(1);
  });
