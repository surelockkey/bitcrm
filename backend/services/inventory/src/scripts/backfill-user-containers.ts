/**
 * Give every user the Workiz import put on a container an assignment row.
 *
 * WHY
 * ---
 * Who works from a van used to live on the container itself: the technician
 * in `technicianId` (one per container, one container per technician) and the
 * Workiz secondary users in the imported `accessUserIds`. The user containers
 * (`USER_CONTAINER#<userId>` / `METADATA`, Workiz "User containers") are the
 * source now — a user has one current container, "All locations" or "No
 * access", and a container many users. Until this runs, the resolver falls
 * back to `technicianId` for users with no row, and the `accessUserIds` users
 * have no container at all.
 *
 * WHAT
 * ----
 * Scans the `CONTAINER#…` / `METADATA` rows and skips (and prints) the archived
 * ones and the Workiz placeholders — nobody is assigned to an inactive van.
 * Every `technicianId` is assigned
 * to its container (named by `technicianName`, `limited` = the container's
 * `userLimited`), then every id in `accessUserIds` (named by the id; the web
 * resolves names from the users directory). Owners first, then the first
 * container by name wins (not Scan order); a user on a second container is
 * printed as a conflict and left on the first. See `planUserContainerBackfill`.
 *
 * Idempotent and upsert-only: a user who already has a row — an admin's
 * choice, or an earlier run — is never touched, and each write is a Put that
 * requires the row to still be absent, so an assignment saved mid-run wins.
 * Nothing is ever removed, and `technicianId` stays on the containers.
 *
 * Run in the same release that deploys user containers, and after every
 * Workiz import.
 *
 * Usage:
 *   npm run backfill:user-containers -w backend/services/inventory
 */
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(__dirname, '../../../../.env') });

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  PutCommand,
  QueryCommand,
  ScanCommand,
  type QueryCommandOutput,
} from '@aws-sdk/lib-dynamodb';
import {
  planUserContainerBackfill,
  type ContainerAccessRow,
} from '../user-containers/user-containers.backfill';
import {
  USER_CONTAINER_GSI1PK,
  userContainerItem,
} from '../user-containers/user-containers.constants';

const INVENTORY_TABLE = process.env.INVENTORY_TABLE || 'BitCRM_Inventory';
const GSI1_NAME = 'CategoryIndex';

async function main() {
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
  console.log(`Table: ${INVENTORY_TABLE}`);

  const containers: ContainerAccessRow[] = [];
  let lastKey: Record<string, unknown> | undefined;
  do {
    const page = await client.send(
      new ScanCommand({
        TableName: INVENTORY_TABLE,
        FilterExpression: 'begins_with(PK, :container) AND SK = :meta',
        ExpressionAttributeValues: { ':container': 'CONTAINER#', ':meta': 'METADATA' },
        ProjectionExpression:
          'PK, id, #name, technicianId, technicianName, userLimited, accessUserIds, #status, placeholder',
        ExpressionAttributeNames: { '#name': 'name', '#status': 'status' },
        ExclusiveStartKey: lastKey,
      }),
    );
    for (const item of page.Items ?? []) {
      containers.push({
        id: (item.id as string | undefined) ?? String(item.PK).slice('CONTAINER#'.length),
        name: item.name as string | undefined,
        technicianId: item.technicianId as string | undefined,
        technicianName: item.technicianName as string | undefined,
        userLimited: item.userLimited as boolean | undefined,
        accessUserIds: Array.isArray(item.accessUserIds) ? (item.accessUserIds as string[]) : undefined,
        status: item.status as string | undefined,
        placeholder: item.placeholder === true,
      });
    }
    lastKey = page.LastEvaluatedKey;
  } while (lastKey);

  const existing = new Set<string>();
  lastKey = undefined;
  do {
    const page: QueryCommandOutput = await client.send(
      new QueryCommand({
        TableName: INVENTORY_TABLE,
        IndexName: GSI1_NAME,
        KeyConditionExpression: 'GSI1PK = :pk',
        ExpressionAttributeValues: { ':pk': USER_CONTAINER_GSI1PK },
        ProjectionExpression: 'userId',
        ExclusiveStartKey: lastKey,
      }),
    );
    for (const item of page.Items ?? []) existing.add(item.userId as string);
    lastKey = page.LastEvaluatedKey;
  } while (lastKey);

  const plan = planUserContainerBackfill(containers, existing, new Date().toISOString());
  for (const skipped of plan.skippedContainers) {
    console.log(`  - container ${skipped.id} (${skipped.name}): ${skipped.reason}, nobody assigned`);
  }
  for (const conflict of plan.conflicts) {
    console.log(
      `  ! ${conflict.userId}: also on container ${conflict.skippedContainerId}, ` +
        `kept on ${conflict.keptContainerId}`,
    );
  }

  let written = 0;
  let raced = 0;
  for (const row of plan.rows) {
    try {
      await client.send(
        new PutCommand({
          TableName: INVENTORY_TABLE,
          Item: userContainerItem(row),
          ConditionExpression: 'attribute_not_exists(PK)',
        }),
      );
      written += 1;
      console.log(`  + ${row.userId} → ${row.containerName} (${row.containerId})`);
    } catch (err) {
      if ((err as Error).name !== 'ConditionalCheckFailedException') throw err;
      raced += 1;
      console.log(`  - ${row.userId}: assigned since the scan, left alone`);
    }
  }

  console.log(
    `\n${containers.length} container(s) scanned, ${plan.skippedContainers.length} skipped ` +
      `(archived or Workiz placeholder), ${written} assignment(s) written, ` +
      `${plan.alreadyAssigned} user(s) already assigned, ${raced} assigned mid-run, ` +
      `${plan.conflicts.length} conflict(s).`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Backfill failed:', err);
    process.exit(1);
  });
