import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(__dirname, '../../../../.env') });

import { QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { DynamoDbService } from '@bitcrm/shared';
import {
  BILLING_GSI1_NAME,
  BILLING_TABLE,
  INVOICES_GSI1PK,
  unpaidIndexKeys,
} from '../common/constants/dynamo.constants';
import { isConditionalCheckFailed } from '../common/dynamo-errors';
import { UnpaidInvoicesRepository } from '../invoices/unpaid-invoices.repository';

/**
 * Backfill: file every open invoice (status `due` / `overdue`, more than a
 * cent owed — Workiz's rule) on UnpaidIndex
 * (`GSI4PK = UNPAID`, `GSI4SK = <id>`) and take every other invoice off it,
 * then stamp `UNPAIDINDEX / STATE` so the readers (Aging invoices, the
 * Invoices report cards, the overdue sweep) switch from the full list to the
 * index.
 *
 * Invoice writes keep the keys current on their own from the moment this
 * code is deployed; this script is for rows written before — the Workiz
 * import above all. Idempotent and upsert-only on the index keys: a row is
 * written only when its keys are wrong, each write is conditioned on the
 * status it was read with (a concurrent status change wins and is left
 * alone). Reads the INVOICES list partition, never a Scan.
 *
 *   npm run backfill:unpaid-index -w billing-service              # apply
 *   npm run backfill:unpaid-index -w billing-service -- --dry-run # count only
 *
 * Run it after the deploy that ships UnpaidIndex (Terraform first), and again
 * after every Workiz import.
 */

interface Row {
  PK: string;
  id: string;
  status?: string;
  totals?: { balanceDue?: number };
  GSI4PK?: string;
  GSI4SK?: string;
}

/** What one invoice row needs, or `null` when its keys are already right. */
export function unpaidIndexFix(row: Row): { set?: { GSI4PK: string; GSI4SK: string }; remove?: true } | null {
  // Open status and more than a cent owed (Workiz's rule); no balance = 0.
  const want = unpaidIndexKeys(row.id, row.status, row.totals?.balanceDue ?? 0);
  if (want) {
    return row.GSI4PK === want.GSI4PK && row.GSI4SK === want.GSI4SK ? null : { set: want };
  }
  return row.GSI4PK || row.GSI4SK ? { remove: true } : null;
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');
  const db = new DynamoDbService();
  let seen = 0;
  let open = 0;
  let filed = 0;
  let unfiled = 0;
  let raced = 0;
  let startKey: Record<string, unknown> | undefined;

  do {
    const page = await db.client.send(
      new QueryCommand({
        TableName: BILLING_TABLE,
        IndexName: BILLING_GSI1_NAME,
        KeyConditionExpression: 'GSI1PK = :pk',
        ExpressionAttributeValues: { ':pk': INVOICES_GSI1PK },
        ProjectionExpression: 'PK, id, #status, totals, GSI4PK, GSI4SK',
        ExpressionAttributeNames: { '#status': 'status' },
        ExclusiveStartKey: startKey,
      }),
    );
    for (const item of (page.Items ?? []) as Row[]) {
      seen++;
      if (unpaidIndexKeys(item.id, item.status, item.totals?.balanceDue ?? 0)) open++;
      const fix = unpaidIndexFix(item);
      if (!fix) continue;
      if (fix.set) filed++;
      else unfiled++;
      if (dryRun) continue;
      try {
        await db.client.send(
          new UpdateCommand({
            TableName: BILLING_TABLE,
            Key: { PK: item.PK, SK: 'METADATA' },
            UpdateExpression: fix.set ? 'SET GSI4PK = :pk4, GSI4SK = :sk4' : 'REMOVE GSI4PK, GSI4SK',
            // On the status AND balance it was read with: a payment landing meanwhile wins.
            ConditionExpression:
              typeof item.totals?.balanceDue === 'number' ? '#status = :seen AND #tot.#bal = :bal' : '#status = :seen',
            ExpressionAttributeNames: {
              '#status': 'status',
              ...(typeof item.totals?.balanceDue === 'number' && { '#tot': 'totals', '#bal': 'balanceDue' }),
            },
            ExpressionAttributeValues: {
              ':seen': item.status ?? null,
              ...(typeof item.totals?.balanceDue === 'number' && { ':bal': item.totals.balanceDue }),
              ...(fix.set && { ':pk4': fix.set.GSI4PK, ':sk4': fix.set.GSI4SK }),
            },
          }),
        );
      } catch (err) {
        // The status moved since the read: the live write set the keys itself.
        if (isConditionalCheckFailed(err)) raced++;
        else throw err;
      }
    }
    startKey = page.LastEvaluatedKey;
    if (seen % 10_000 < (page.Items?.length ?? 0)) console.log(`… ${seen} invoices read`);
  } while (startKey);

  console.log(
    `${seen} invoices, ${open} open. ${dryRun ? 'Would file' : 'Filed'} ${filed}, ` +
      `${dryRun ? 'would take off' : 'took off'} ${unfiled}${raced ? `, ${raced} changed meanwhile (left to the live write)` : ''}.`,
  );
  if (!dryRun) {
    await new UnpaidInvoicesRepository(db).markReady(open);
    console.log('UNPAIDINDEX / STATE stamped — the reports now read UnpaidIndex.');
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error('backfill-unpaid-index failed:', err);
    process.exit(1);
  });
}
