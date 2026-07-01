/**
 * Migration: create a pending technician profile for every existing user with
 * the technician role that doesn't already have one. Technician profiles were
 * introduced after some technician users already existed, so those users don't
 * appear in GET /technicians or onboarding tracking until a profile exists.
 *
 * Idempotent and prod-safe (DynamoDB honours DYNAMODB_ENDPOINT for local).
 *
 *   ts-node src/scripts/backfill-technician-profiles.ts            # apply
 *   ts-node src/scripts/backfill-technician-profiles.ts --dry-run  # preview
 *
 * Env: USERS_TABLE, AWS_REGION, optional DYNAMODB_ENDPOINT.
 */
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(__dirname, '../../../../.env') });

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';
import { type User } from '@bitcrm/types';

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

  console.log(`Backfill technician profiles — table=${USERS_TABLE} region=${region}`);
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
        new GetCommand({
          TableName: USERS_TABLE,
          Key: { PK: `USER#${user.id}`, SK: 'TECH_PROFILE' },
        }),
      );
      if (existing.Item) {
        console.log(`  = ${user.email}: profile already exists`);
        continue;
      }

      created++;
      console.log(`  + ${user.email} (${user.id}): create pending profile`);
      if (!DRY_RUN) {
        const now = new Date().toISOString();
        await doc.send(
          new PutCommand({
            TableName: USERS_TABLE,
            Item: {
              PK: `USER#${user.id}`,
              SK: 'TECH_PROFILE',
              GSI3PK: 'TECHNICIAN',
              GSI3SK: `pending#${user.id}`,
              userId: user.id,
              callMaskingEnabled: false,
              gpsTrackingEnabled: false,
              mobileAppInstalled: false,
              status: 'pending',
              createdAt: now,
              updatedAt: now,
            },
            ConditionExpression: 'attribute_not_exists(PK)',
          }),
        );
      }
    }
    lastKey = res.LastEvaluatedKey;
  } while (lastKey);

  console.log(
    `\nDone. ${scanned} technician users, ${created} profiles ${
      DRY_RUN ? 'would be created (dry run)' : 'created'
    }.`,
  );
}

main().catch((err) => {
  console.error('Technician profile backfill failed:', err);
  process.exit(1);
});
