/**
 * Schema migration + backfill for the calls table's global list index.
 *
 * 1. Ensure the `AllCallsIndex` GSI exists (online UpdateTable, wait ACTIVE) —
 *    modeled on user-service's ensure-indexes.ts.
 * 2. Backfill GSI2 keys onto existing CALL# items that predate the index.
 *
 * Idempotent — safe to run repeatedly. Exported as `ensureCallsGsi2()` so the
 * telephony service runs it automatically at boot (DbSetupService); also
 * runnable manually:
 *
 *   ts-node src/scripts/ensure-gsi2.ts [--dry-run]
 */
import {
  DynamoDBClient,
  DescribeTableCommand,
  UpdateTableCommand,
} from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  ScanCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import {
  CALLS_TABLE,
  CALLS_GSI2_NAME,
  ALL_CALLS_PK,
  allCallsSk,
} from '../common/constants/dynamo.constants';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface EnsureGsi2Result {
  indexCreated: boolean;
  itemsBackfilled: number;
}

function buildClient(): DynamoDBClient {
  return new DynamoDBClient({
    region: process.env.AWS_REGION || 'us-east-1',
    ...(process.env.DYNAMODB_ENDPOINT && {
      endpoint: process.env.DYNAMODB_ENDPOINT,
      credentials: { accessKeyId: 'local', secretAccessKey: 'local' },
    }),
  });
}

async function waitActive(client: DynamoDBClient): Promise<void> {
  for (let i = 0; i < 60; i++) {
    const { Table } = await client.send(
      new DescribeTableCommand({ TableName: CALLS_TABLE }),
    );
    const gsiStatuses = (Table?.GlobalSecondaryIndexes || []).map(
      (g) => g.IndexStatus,
    );
    if (
      Table?.TableStatus === 'ACTIVE' &&
      gsiStatuses.every((s) => s === 'ACTIVE')
    ) {
      return;
    }
    await sleep(2000);
  }
  throw new Error('Timed out waiting for calls table/indexes to become ACTIVE');
}

/** Add the GSI when missing. Returns true when it had to be created. */
async function ensureIndex(
  client: DynamoDBClient,
  dryRun: boolean,
  log: (msg: string) => void,
): Promise<boolean> {
  const { Table } = await client.send(
    new DescribeTableCommand({ TableName: CALLS_TABLE }),
  );
  const existing = new Set(
    (Table?.GlobalSecondaryIndexes || []).map((g) => g.IndexName),
  );
  if (existing.has(CALLS_GSI2_NAME)) {
    log(`${CALLS_GSI2_NAME}: present`);
    return false;
  }
  if (dryRun) {
    log(`[dry-run] ${CALLS_GSI2_NAME}: would create`);
    return true;
  }

  log(`${CALLS_GSI2_NAME}: creating (online UpdateTable)…`);
  await client.send(
    new UpdateTableCommand({
      TableName: CALLS_TABLE,
      AttributeDefinitions: [
        { AttributeName: 'GSI2PK', AttributeType: 'S' },
        { AttributeName: 'GSI2SK', AttributeType: 'S' },
      ],
      GlobalSecondaryIndexUpdates: [
        {
          Create: {
            IndexName: CALLS_GSI2_NAME,
            KeySchema: [
              { AttributeName: 'GSI2PK', KeyType: 'HASH' },
              { AttributeName: 'GSI2SK', KeyType: 'RANGE' },
            ],
            Projection: { ProjectionType: 'ALL' },
          },
        },
      ],
    }),
  );
  await waitActive(client);
  log(`${CALLS_GSI2_NAME}: ACTIVE`);
  return true;
}

/** Write GSI2 keys onto CALL# items that don't have them yet. */
async function backfill(
  doc: DynamoDBDocumentClient,
  dryRun: boolean,
  log: (msg: string) => void,
): Promise<number> {
  let updated = 0;
  let exclusiveStartKey: Record<string, unknown> | undefined;

  do {
    const res: {
      Items?: Record<string, unknown>[];
      LastEvaluatedKey?: Record<string, unknown>;
    } = await doc.send(
      new ScanCommand({
        TableName: CALLS_TABLE,
        FilterExpression:
          'begins_with(PK, :call) AND SK = :meta AND attribute_not_exists(GSI2PK)',
        ExpressionAttributeValues: { ':call': 'CALL#', ':meta': 'METADATA' },
        ...(exclusiveStartKey && { ExclusiveStartKey: exclusiveStartKey }),
      }),
    );

    for (const it of res.Items ?? []) {
      // Old records may lack the callSid attribute — derive it from the PK.
      const callSid =
        (it.callSid as string) ?? (it.PK as string)?.replace(/^CALL#/, '');
      const startedAt = (it.startedAt as string) ?? (it.updatedAt as string);
      if (!callSid || !startedAt) continue;
      if (dryRun) {
        log(`[dry-run] would backfill ${callSid}`);
        updated += 1;
        continue;
      }
      await doc.send(
        new UpdateCommand({
          TableName: CALLS_TABLE,
          Key: { PK: it.PK, SK: it.SK },
          UpdateExpression: 'SET GSI2PK = :pk, GSI2SK = :sk',
          ConditionExpression: 'attribute_exists(PK)',
          ExpressionAttributeValues: {
            ':pk': ALL_CALLS_PK,
            ':sk': allCallsSk(startedAt, callSid),
          },
        }),
      );
      updated += 1;
    }
    exclusiveStartKey = res.LastEvaluatedKey;
  } while (exclusiveStartKey);

  return updated;
}

/** The whole migration: ensure index + backfill. Used by boot + CLI. */
export async function ensureCallsGsi2(
  options: { dryRun?: boolean; log?: (msg: string) => void } = {},
): Promise<EnsureGsi2Result> {
  const log = options.log ?? (() => undefined);
  const client = buildClient();
  const doc = DynamoDBDocumentClient.from(client, {
    marshallOptions: { removeUndefinedValues: true },
  });

  try {
    const dryRun = options.dryRun ?? false;
    const indexCreated = await ensureIndex(client, dryRun, log);
    const itemsBackfilled = await backfill(doc, dryRun, log);
    if (itemsBackfilled > 0) {
      log(`backfilled GSI2 keys on ${itemsBackfilled} call record(s)`);
    }
    return { indexCreated, itemsBackfilled };
  } finally {
    client.destroy();
  }
}

/* CLI entry */
if (require.main === module) {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { config } = require('dotenv');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { resolve } = require('path');
  config({ path: resolve(__dirname, '../../../../.env') });

  const dryRun = process.argv.includes('--dry-run');
  ensureCallsGsi2({ dryRun, log: (m) => console.log(`  ${m}`) })
    .then((r) =>
      console.log(
        `\nDone. indexCreated=${r.indexCreated} itemsBackfilled=${r.itemsBackfilled}${dryRun ? ' (dry run)' : ''}`,
      ),
    )
    .catch((err) => {
      console.error('ensure-gsi2 failed:', err);
      process.exit(1);
    });
}
