/**
 * Clear released job codes whose quarantine has passed.
 *
 * A scheduled script rather than a DynamoDB TTL because nothing in this repo
 * uses TTL, and adding it here would mean editing the ddb-table module that
 * every table in the system shares.
 *
 * Quarantine is the point of the delay: a released code stays unusable so that
 * a code which connected somebody to the Hendersons cannot, three weeks later,
 * connect somebody to the Wus. Only once it is well past that window is the
 * row dropped and the code free to be drawn again.
 *
 *   npx ts-node src/scripts/sweep-call-exts.ts            # dry run
 *   npx ts-node src/scripts/sweep-call-exts.ts --apply    # actually delete
 */
import 'dotenv/config';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { ExtsRepository } from '../exts/exts.repository';

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');

  const client = DynamoDBDocumentClient.from(
    new DynamoDBClient({
      region: process.env.AWS_REGION || 'us-east-1',
      ...(process.env.DYNAMODB_ENDPOINT
        ? { endpoint: process.env.DYNAMODB_ENDPOINT }
        : {}),
    }),
  );

  const repo = new ExtsRepository({ client } as never);
  const codes = await repo.listSweepable();

  if (codes.length === 0) {
    console.log('Nothing to sweep.');
    return;
  }

  console.log(
    `${codes.length} released code(s) past quarantine${apply ? '' : ' (dry run)'}:`,
  );
  for (const code of codes) {
    // Truncated even here: a sweep log sitting in CloudWatch is exactly the
    // kind of place a full list of codes should not accumulate.
    console.log(`  ***${code.slice(-3)}`);
    if (apply) await repo.purge(code);
  }

  console.log(apply ? 'Swept.' : 'Dry run — pass --apply to delete.');
}

main().catch((error) => {
  console.error('Sweep failed:', error);
  process.exit(1);
});
