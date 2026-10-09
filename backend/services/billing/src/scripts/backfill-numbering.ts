import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(__dirname, '../../../../.env') });

import { QueryCommand } from '@aws-sdk/lib-dynamodb';
import { DynamoDbService } from '@bitcrm/shared';
import {
  BILLING_GSI1_NAME,
  BILLING_TABLE,
  ESTIMATES_GSI1PK,
  INVOICES_GSI1PK,
} from '../common/constants/dynamo.constants';
import { highestClientNumber, planNumberingBackfill, type NumberedRow } from '../numbering/numbering-backfill';
import { NumberingBehindError, NumberingRepository, type NumberingKind } from '../numbering/numbering.repository';

/**
 * Backfill: raise Settings → Numbering's counters (`COUNTERS#ACCOUNT` /
 * `lastInvoiceNumber`, `lastEstimateNumber`) past the numbers the CLIENT
 * documents already carry, so a number in use can never be handed out again
 * and the office cannot set a "next number" below one.
 *
 * Documents made here move the counters themselves; this is for rows that
 * did not — the Workiz import above all (its stub estimates carry 1140,
 * 1139 …). Walks the INVOICES and ESTIMATES list partitions (never a Scan),
 * takes the highest numeric number of the documents with no job, and raises
 * each counter that stands below it with the same conditional update the
 * settings page uses (a counter already past it is left alone). Idempotent.
 *
 *   npm run backfill:numbering -w billing-service              # apply
 *   npm run backfill:numbering -w billing-service -- --dry-run # report only
 *
 * Run it after the deploy that ships Settings → Numbering, and again after
 * every Workiz import. The cut-over step itself — Next Invoice Id / Next
 * Estimate Id = the numbers after Workiz's last ones — is set on the page.
 */

async function highestOf(db: DynamoDbService, partition: string): Promise<{ highest: number; rows: number }> {
  const rows: NumberedRow[] = [];
  let startKey: Record<string, unknown> | undefined;
  do {
    const page = await db.client.send(
      new QueryCommand({
        TableName: BILLING_TABLE,
        IndexName: BILLING_GSI1_NAME,
        KeyConditionExpression: 'GSI1PK = :pk',
        ExpressionAttributeValues: { ':pk': partition },
        ProjectionExpression: '#n, dealId',
        ExpressionAttributeNames: { '#n': 'number' },
        ExclusiveStartKey: startKey,
      }),
    );
    for (const item of (page.Items ?? []) as NumberedRow[]) rows.push(item);
    startKey = page.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (startKey);
  return { highest: highestClientNumber(rows), rows: rows.length };
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');
  const db = new DynamoDbService();
  const repo = new NumberingRepository(db);

  const [invoices, estimates] = await Promise.all([highestOf(db, INVOICES_GSI1PK), highestOf(db, ESTIMATES_GSI1PK)]);
  console.log(`invoices: ${invoices.rows} rows, highest client number ${invoices.highest}`);
  console.log(`estimates: ${estimates.rows} rows, highest client number ${estimates.highest}`);

  const row = await repo.read();
  const plan = planNumberingBackfill(row, { invoice: invoices.highest, estimate: estimates.highest });
  if (plan.length === 0) {
    console.log('counters already stand past every client document — nothing to do');
    return;
  }
  const now = new Date().toISOString();
  for (const { kind, from, to } of plan) {
    const label: Record<NumberingKind, string> = { invoice: 'lastInvoiceNumber', estimate: 'lastEstimateNumber' };
    if (dryRun) {
      console.log(`[dry-run] would raise ${label[kind]} ${from} → ${to} (next ${kind} ${to + 1})`);
      continue;
    }
    try {
      await repo.setLast(kind, to, 'backfill:numbering', now);
      console.log(`raised ${label[kind]} ${from} → ${to} (next ${kind} ${to + 1})`);
    } catch (err) {
      if (err instanceof NumberingBehindError) {
        console.log(`${label[kind]} moved past ${to} meanwhile — left alone`);
        continue;
      }
      throw err;
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
