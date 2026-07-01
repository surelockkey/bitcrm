/**
 * Migration: backfill permission/dataScope entries for resources added to the
 * registry after roles were already seeded (e.g. technicians, skills,
 * commission). Idempotent and safe to run repeatedly, locally or on prod.
 *
 * It mirrors the self-healing reconcile that RolesService.seedDefaults() runs on
 * boot, but as an explicit one-shot so you don't have to wait for a deploy, and
 * it also flushes the resolved-permission caches in Redis.
 *
 * Usage (local uses DYNAMODB_ENDPOINT from .env; prod uses real AWS creds):
 *   ts-node src/scripts/backfill-role-permissions.ts            # apply
 *   ts-node src/scripts/backfill-role-permissions.ts --dry-run  # preview only
 *
 * Target table/region come from env: USERS_TABLE (default BitCRM_Users),
 * AWS_REGION, optional DYNAMODB_ENDPOINT (local), REDIS_URL (optional).
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
import Redis from 'ioredis';
import { type Role } from '@bitcrm/types';
import { DEFAULT_ROLES } from '../roles/constants/default-roles';
import { reconcileRolePermissions } from '../roles/reconcile-role-permissions';

const USERS_TABLE = process.env.USERS_TABLE || 'BitCRM_Users';
const DRY_RUN = process.argv.includes('--dry-run');

const DEFAULT_BY_NAME = new Map(DEFAULT_ROLES.map((r) => [r.name, r]));

async function main() {
  const region = process.env.AWS_REGION || 'us-east-1';
  const client = new DynamoDBClient({
    region,
    ...(process.env.DYNAMODB_ENDPOINT && {
      endpoint: process.env.DYNAMODB_ENDPOINT,
      credentials: { accessKeyId: 'local', secretAccessKey: 'local' },
    }),
  });
  const doc = DynamoDBDocumentClient.from(client, {
    marshallOptions: { removeUndefinedValues: true },
  });

  console.log(`Backfill role permissions — table=${USERS_TABLE} region=${region}`);
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN' : 'LIVE'}\n`);

  const reconciledRoleIds: string[] = [];
  let scanned = 0;
  let lastKey: Record<string, unknown> | undefined;

  do {
    const res = await doc.send(
      new ScanCommand({
        TableName: USERS_TABLE,
        FilterExpression: 'begins_with(PK, :pk) AND SK = :sk',
        ExpressionAttributeValues: { ':pk': 'ROLE#', ':sk': 'METADATA' },
        ExclusiveStartKey: lastKey,
      }),
    );

    for (const role of (res.Items || []) as Role[]) {
      scanned++;

      const def = DEFAULT_BY_NAME.get(role.name);
      if (!def) {
        // Custom (or non-default system) role: absent resources are deny-by-default
        // at the guard, so no change is required for correctness.
        console.log(`  - skip "${role.name}" (${role.id}): no default definition`);
        continue;
      }

      const { permissions, dataScope, changed } = reconcileRolePermissions(
        { permissions: role.permissions || {}, dataScope: role.dataScope || {} },
        def,
      );
      if (!changed) {
        console.log(`  = ok   "${role.name}" (${role.id}): already complete`);
        continue;
      }

      const added = Object.keys(permissions).filter(
        (r) => !(r in (role.permissions || {})),
      );
      console.log(`  + fix  "${role.name}" (${role.id}): add [${added.join(', ')}]`);
      reconciledRoleIds.push(role.id);

      if (!DRY_RUN) {
        await doc.send(
          new UpdateCommand({
            TableName: USERS_TABLE,
            Key: { PK: `ROLE#${role.id}`, SK: 'METADATA' },
            UpdateExpression: 'SET #p = :p, #d = :d, #u = :u',
            ExpressionAttributeNames: {
              '#p': 'permissions',
              '#d': 'dataScope',
              '#u': 'updatedAt',
            },
            ExpressionAttributeValues: {
              ':p': permissions,
              ':d': dataScope,
              ':u': new Date().toISOString(),
            },
            ConditionExpression: 'attribute_exists(PK)',
          }),
        );
      }
    }
    lastKey = res.LastEvaluatedKey;
  } while (lastKey);

  // Flush resolved-permission caches so the guard recomputes them.
  if (!DRY_RUN && reconciledRoleIds.length > 0 && process.env.REDIS_URL) {
    const redis = new Redis(process.env.REDIS_URL, { maxRetriesPerRequest: 3 });
    const keys = await redis.keys('role:permissions:*');
    const userKeys = await redis.keys('user:permissions:*');
    const all = [...keys, ...userKeys];
    if (all.length > 0) await redis.del(...all);
    await redis.quit();
    console.log(`\nFlushed ${all.length} cached permission entries from Redis.`);
  }

  console.log(
    `\nDone. Scanned ${scanned} roles, ${reconciledRoleIds.length} reconciled${
      DRY_RUN ? ' (dry run — no writes)' : ''
    }.`,
  );
}

main().catch((err) => {
  console.error('Backfill failed:', err);
  process.exit(1);
});
