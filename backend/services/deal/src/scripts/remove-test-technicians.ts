import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(__dirname, '../../../../.env') });

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DeleteCommand, DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';
import { DEALS_TABLE } from '../common/constants/dynamo.constants';

/**
 * Remove the ten fake technicians a seeding script wrote into the live deals
 * table (`test-tech-ct-1` … `-10`, PK `TECH_ELIGIBILITY#<id>`). They were
 * eligibility rows and nothing else — no user, no login, no role — so they
 * could be offered for a Connecticut job and found nowhere else, which is
 * exactly how the owner met them.
 *
 * The reconcile in `TechnicianEligibilityEventHandler`'s sibling
 * (`technician-eligibility.reconciler.ts`) removes them on the next boot as
 * well, but it skips when user-service answers with an empty roster — and an
 * account where nobody has been onboarded properly is precisely where fakes
 * get seeded. So this exists to finish the job without waiting on that.
 *
 * Prints what it would delete and stops. Pass `--yes` to actually delete.
 *
 *   DEALS_TABLE=<table> npx ts-node src/scripts/remove-test-technicians.ts
 *   DEALS_TABLE=<table> npx ts-node src/scripts/remove-test-technicians.ts --yes
 */
const SEEDED_IDS = Array.from({ length: 10 }, (_, i) => `test-tech-ct-${i + 1}`);

async function main() {
  const apply = process.argv.includes('--yes');
  const client = DynamoDBDocumentClient.from(
    new DynamoDBClient({
      region: process.env.AWS_REGION || 'us-east-1',
      ...(process.env.AWS_ENDPOINT && {
        endpoint: process.env.AWS_ENDPOINT,
        credentials: { accessKeyId: 'local', secretAccessKey: 'local' },
      }),
    }),
  );

  console.log(`Table: ${DEALS_TABLE}`);
  console.log(apply ? 'Deleting.\n' : 'Dry run — nothing is deleted. Add --yes to delete.\n');

  let found = 0;
  for (const id of SEEDED_IDS) {
    const key = { PK: `TECH_ELIGIBILITY#${id}`, SK: 'ELIGIBILITY' };
    const { Item } = await client.send(new GetCommand({ TableName: DEALS_TABLE, Key: key }));
    if (!Item) {
      console.log(`  · ${id} — not there`);
      continue;
    }
    found += 1;
    const name = [Item.firstName, Item.lastName].filter(Boolean).join(' ') || '(no name)';
    console.log(`  ${apply ? '-' : '?'} ${id} — ${name}`);
    // Deleting by the exact key of a row this script named itself: nothing
    // else in the table can match, and a row already gone is not an error.
    if (apply) await client.send(new DeleteCommand({ TableName: DEALS_TABLE, Key: key }));
  }

  console.log(
    `\n${found} of ${SEEDED_IDS.length} seeded rows ${apply ? 'deleted' : 'found'}.` +
      (found && !apply ? ' Re-run with --yes to delete them.' : ''),
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
