/**
 * Migration: ensure every technician user has a commission config, creating the
 * EPIC-6 default (40% base / 3% CC / 0% ACH) for any that lack one — so
 * reporting/payouts can compute. Idempotent and prod-safe (mirrors the
 * boot-time self-heal in UsersService.onModuleInit).
 *
 *   ts-node src/scripts/backfill-commission.ts            # apply
 *   ts-node src/scripts/backfill-commission.ts --dry-run  # preview
 *
 * Env: USERS_TABLE, AWS_REGION, optional DYNAMODB_ENDPOINT.
 */
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(__dirname, '../../../../.env') });

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  QueryCommand,
  PutCommand,
} from '@aws-sdk/lib-dynamodb';
import { type User } from '@bitcrm/types';
import {
  DEFAULT_COMMISSION,
  buildDefaultCommission,
} from '../technicians/commission/commission.defaults';

const USERS_TABLE = process.env.USERS_TABLE || 'BitCRM_Users';
const TECHNICIAN_ROLE_ID = 'role-technician';
const DRY_RUN = process.argv.includes('--dry-run');

async function main() {
  const region = process.env.AWS_REGION || 'us-east-1';
  const doc = DynamoDBDocumentClient.from(
    new DynamoDBClient({
      region,
      ...(process.env.DYNAMODB_ENDPOINT && {
        endpoint: process.env.DYNAMODB_ENDPOINT,
        credentials: { accessKeyId: 'local', secretAccessKey: 'local' },
      }),
    }),
    { marshallOptions: { removeUndefinedValues: true } },
  );

  console.log(`Backfill commission — table=${USERS_TABLE} region=${region}`);
  console.log(
    `Default: ${DEFAULT_COMMISSION.baseRatePct}% base / ${DEFAULT_COMMISSION.creditCardFeePct}% CC / ${DEFAULT_COMMISSION.achFeePct}% ACH`,
  );
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN' : 'LIVE'}\n`);

  let created = 0;
  let scanned = 0;
  let lastKey: Record<string, unknown> | undefined;

  do {
    const res = await doc.send(
      new QueryCommand({
        TableName: USERS_TABLE,
        IndexName: 'RoleIndex',
        KeyConditionExpression: 'GSI1PK = :pk',
        ExpressionAttributeValues: { ':pk': `ROLE_USER#${TECHNICIAN_ROLE_ID}` },
        ExclusiveStartKey: lastKey,
      }),
    );

    for (const user of (res.Items || []) as User[]) {
      scanned++;
      const existing = await doc.send(
        new QueryCommand({
          TableName: USERS_TABLE,
          KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
          ExpressionAttributeValues: { ':pk': `USER#${user.id}`, ':sk': 'COMMISSION#' },
          Limit: 1,
        }),
      );
      if ((existing.Items || []).length > 0) {
        console.log(`  = ${user.email}: commission already configured`);
        continue;
      }

      created++;
      const cfg = buildDefaultCommission(user.id, 'system-backfill', new Date().toISOString());
      console.log(`  + ${user.email} (${user.id}): create default commission`);
      if (!DRY_RUN) {
        await doc.send(
          new PutCommand({
            TableName: USERS_TABLE,
            Item: { PK: `USER#${user.id}`, SK: `COMMISSION#${cfg.effectiveDate}`, ...cfg },
            ConditionExpression: 'attribute_not_exists(SK)',
          }),
        );
      }
    }
    lastKey = res.LastEvaluatedKey;
  } while (lastKey);

  console.log(
    `\nDone. ${scanned} technicians, ${created} default config(s) ${
      DRY_RUN ? 'would be created (dry run)' : 'created'
    }.`,
  );
}

main().catch((err) => {
  console.error('Commission backfill failed:', err);
  process.exit(1);
});
