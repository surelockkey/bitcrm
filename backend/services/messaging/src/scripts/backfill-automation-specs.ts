/**
 * Save the Workiz translation onto every imported automation rule that is
 * still translated on read.
 *
 * WHY
 * ---
 * `GET /automations` lays the translator's output over each imported Workiz
 * rule whose stored spec is missing or older than `TRANSLATOR_VERSION`
 * (`AutomationsService.overlay`). The answer is cached now, but each cache
 * fill still re-runs the translator over every such row. Once the rows carry
 * the current translation there is nothing left to compute.
 *
 * WHAT
 * ----
 * Query the catalog partition (GSI3 CategoryIndex `CATALOG#AUTOMATION`, tens
 * of rows — no Scan); for every row `needsTranslation` picks, an `UpdateItem`
 * of the spec fields only (`automationSpecBackfillUpdate`), conditional on the
 * row being exactly as read — a rule somebody edited or deleted meanwhile is
 * left alone and counted as raced. Idempotent and upsert-only: a second run
 * finds nothing to do. Unlike `POST /automations/migrate` it stamps no
 * `updatedAt` / `updatedBy` — it is not an edit.
 *
 * The `GET /automations` cache needs no flush: it already holds exactly these
 * translations (same translator version), and its 5-minute TTL covers the
 * rest.
 *
 * USAGE
 * -----
 *   npm run backfill:automation-specs -w backend/services/messaging               # dry run: count only
 *   npm run backfill:automation-specs -w backend/services/messaging -- --apply    # write
 *
 *   against dev:
 *   AWS_PROFILE=bitcrm-dev DYNAMODB_ENDPOINT= MESSAGING_TABLE=bitcrm-dev-messaging \
 *     npm run backfill:automation-specs -w backend/services/messaging
 *
 * Run it after every deploy that raises `TRANSLATOR_VERSION` and after every
 * Workiz import that brings automation rules.
 */
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(__dirname, '../../../../.env') });

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { type AutomationRule } from '@bitcrm/types';
import { AUTOMATION_CATALOG_GSI3PK } from '../automations/automations.constants';
import { automationSpecBackfillUpdate } from '../automations/translator/automation-spec-backfill';
import { TRANSLATOR_VERSION } from '../automations/translator/workiz-translator';
import { MESSAGING_GSI3_NAME, MESSAGING_TABLE } from '../common/constants/dynamo.constants';
import { stripKeys } from '../common/items';

const APPLY = process.argv.includes('--apply');

// An empty DYNAMODB_ENDPOINT (set on the command line to override .env) means
// real AWS, with the profile / role the SDK's default chain finds.
const client = DynamoDBDocumentClient.from(
  new DynamoDBClient({
    region: process.env.AWS_REGION || 'us-east-1',
    maxAttempts: 10,
    ...(process.env.DYNAMODB_ENDPOINT && {
      endpoint: process.env.DYNAMODB_ENDPOINT,
      credentials: { accessKeyId: 'local', secretAccessKey: 'local' },
    }),
  }),
  { marshallOptions: { removeUndefinedValues: true, convertClassInstanceToMap: true } },
);

async function main(): Promise<void> {
  const stats = { rules: 0, upToDate: 0, outdated: 0, written: 0, raced: 0 };
  console.log(
    `backfill:automation-specs on ${MESSAGING_TABLE} — translator v${TRANSLATOR_VERSION}${APPLY ? '' : ' (dry run; --apply writes)'}`,
  );

  let lastKey: Record<string, unknown> | undefined;
  do {
    const page = await client.send(
      new QueryCommand({
        TableName: MESSAGING_TABLE,
        IndexName: MESSAGING_GSI3_NAME,
        KeyConditionExpression: 'GSI3PK = :pk',
        ExpressionAttributeValues: { ':pk': AUTOMATION_CATALOG_GSI3PK },
        ExclusiveStartKey: lastKey,
      }),
    );
    for (const item of page.Items ?? []) {
      stats.rules += 1;
      const rule = stripKeys<AutomationRule>(item);
      const update = automationSpecBackfillUpdate(rule, MESSAGING_TABLE);
      if (!update) {
        stats.upToDate += 1;
        continue;
      }
      stats.outdated += 1;
      const was = rule.specVersion === undefined ? 'untranslated' : `${rule.specSource ?? '?'} v${rule.specVersion}`;
      if (!APPLY) {
        console.log(`  would write ${rule.id} "${rule.name}" (${was})`);
        continue;
      }
      try {
        await client.send(new UpdateCommand(update));
        stats.written += 1;
        console.log(`  wrote ${rule.id} "${rule.name}" (${was} → v${TRANSLATOR_VERSION})`);
      } catch (err) {
        if ((err as Error).name === 'ConditionalCheckFailedException') {
          stats.raced += 1;
          console.log(`  skipped ${rule.id}: changed since it was read`);
          continue;
        }
        throw err;
      }
    }
    lastKey = page.LastEvaluatedKey;
  } while (lastKey);

  console.log(JSON.stringify(stats));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
