/**
 * Move the dead `TechnicianProfile.callMaskingEnabled` switch onto the
 * permission that replaces it.
 *
 * The old flag was a verified dead end: nothing in telephony ever read it, and
 * it could never have covered everybody anyway — profiles exist only for
 * `role-technician`, so a dispatcher had no place to hold one, and forcing a
 * profile onto them would stamp `GSI3PK='TECHNICIAN'` and make them appear on
 * the dispatch board as an assignable technician.
 *
 * This migration moves the EXCEPTIONS, not the defaults. Every profile ever
 * provisioned was written with `callMaskingEnabled: false`, and the seeded
 * roles all ship with `contacts.view_numbers: true` — so a profile set to
 * false already agrees with its role and needs nothing. Only a profile somebody
 * deliberately switched ON becomes a per-user override.
 *
 *   ts-node src/scripts/migrate-call-masking.ts            # dry run
 *   ts-node src/scripts/migrate-call-masking.ts --apply
 */
import 'dotenv/config';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  QueryCommand,
  GetCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import {
  TECHNICIANS_TABLE as USERS_TABLE,
  GSI3_NAME,
  TECHNICIAN_GSI_PK,
} from '../technicians/constants/dynamo.constants';

const APPLY = process.argv.includes('--apply');

async function main(): Promise<void> {
  const doc = DynamoDBDocumentClient.from(
    new DynamoDBClient({
      region: process.env.AWS_REGION || 'us-east-1',
      ...(process.env.DYNAMODB_ENDPOINT
        ? { endpoint: process.env.DYNAMODB_ENDPOINT }
        : {}),
    }),
  );

  console.log(`Mode: ${APPLY ? 'LIVE' : 'DRY RUN'}\n`);

  let lastKey: Record<string, unknown> | undefined;
  let scanned = 0;
  let migrated = 0;

  do {
    const res = await doc.send(
      new QueryCommand({
        TableName: USERS_TABLE,
        IndexName: GSI3_NAME,
        KeyConditionExpression: 'GSI3PK = :pk',
        ExpressionAttributeValues: { ':pk': TECHNICIAN_GSI_PK },
        ExclusiveStartKey: lastKey,
      }),
    );

    for (const profile of (res.Items ?? []) as Array<{
      userId?: string;
      callMaskingEnabled?: boolean;
    }>) {
      scanned += 1;
      if (!profile.userId || profile.callMaskingEnabled !== true) continue;

      // Merge rather than replace: a user may hold other overrides that have
      // nothing to do with masking, and this must not be the thing that
      // silently drops them.
      const current = await doc.send(
        new GetCommand({
          TableName: USERS_TABLE,
          Key: { PK: `USER#${profile.userId}`, SK: 'METADATA' },
          ProjectionExpression: 'permissionOverrides',
        }),
      );
      const existing =
        (current.Item?.permissionOverrides as {
          permissions?: Record<string, Record<string, boolean>>;
        }) ?? {};

      const next = {
        ...existing,
        permissions: {
          ...(existing.permissions ?? {}),
          contacts: {
            ...(existing.permissions?.contacts ?? {}),
            view_numbers: false,
          },
        },
      };

      console.log(`  ~ ${profile.userId}: masking on → contacts.view_numbers = false`);
      migrated += 1;

      if (APPLY) {
        await doc.send(
          new UpdateCommand({
            TableName: USERS_TABLE,
            Key: { PK: `USER#${profile.userId}`, SK: 'METADATA' },
            UpdateExpression: 'SET permissionOverrides = :o, updatedAt = :now',
            ExpressionAttributeValues: {
              ':o': next,
              ':now': new Date().toISOString(),
            },
            ConditionExpression: 'attribute_exists(PK)',
          }),
        );
      }
    }
    lastKey = res.LastEvaluatedKey;
  } while (lastKey);

  console.log(
    `\n${scanned} profile(s) scanned, ${migrated} migrated${APPLY ? '' : ' (dry run — no writes)'}.`,
  );
  if (migrated > 0 && APPLY) {
    console.log(
      'Flush user:permissions:* in Redis, or wait 60s for the caches to expire.',
    );
  }
}

main().catch((error) => {
  console.error('Migration failed:', error);
  process.exit(1);
});
