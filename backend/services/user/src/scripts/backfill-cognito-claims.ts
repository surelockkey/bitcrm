/**
 * Migration: reconcile Cognito custom claims with the authoritative DynamoDB
 * user records. Fixes legacy users whose `custom:user_id` drifted (e.g. it was
 * set to the Cognito `sub` instead of the app user id) or whose `custom:role_id`
 * is missing — which makes `GET /me` return "user not found" and the permission
 * guard deny everything.
 *
 * For each DynamoDB USER# record it sets, on the matching Cognito user
 * (Username = cognitoSub): custom:user_id, custom:role_id, custom:department.
 *
 * Affected users must obtain a NEW token (re-login or refresh) afterwards — the
 * updated claims only appear in newly-issued ID tokens.
 *
 * Usage (DynamoDB honours DYNAMODB_ENDPOINT for local; Cognito is always real AWS):
 *   ts-node src/scripts/backfill-cognito-claims.ts --dry-run   # preview diff (default-safe)
 *   ts-node src/scripts/backfill-cognito-claims.ts --apply     # write changes
 *
 * Env: USERS_TABLE, AWS_REGION, COGNITO_USER_POOL_ID, optional DYNAMODB_ENDPOINT.
 */
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(__dirname, '../../../../.env') });

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand } from '@aws-sdk/lib-dynamodb';
import {
  CognitoIdentityProviderClient,
  AdminGetUserCommand,
  AdminUpdateUserAttributesCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import { type User } from '@bitcrm/types';
import { cognitoClaimsFor } from '../users/cognito-claims.util';

const USERS_TABLE = process.env.USERS_TABLE || 'BitCRM_Users';
const APPLY = process.argv.includes('--apply');

async function main() {
  const region = process.env.AWS_REGION || 'us-east-1';
  const userPoolId = process.env.COGNITO_USER_POOL_ID;
  if (!userPoolId) throw new Error('COGNITO_USER_POOL_ID is not set');

  const ddb = DynamoDBDocumentClient.from(
    new DynamoDBClient({
      region,
      ...(process.env.DYNAMODB_ENDPOINT && {
        endpoint: process.env.DYNAMODB_ENDPOINT,
        credentials: { accessKeyId: 'local', secretAccessKey: 'local' },
      }),
    }),
    { marshallOptions: { removeUndefinedValues: true } },
  );
  const cognito = new CognitoIdentityProviderClient({ region });

  console.log(
    `Backfill Cognito claims — table=${USERS_TABLE} pool=${userPoolId} region=${region}`,
  );
  console.log(`Mode: ${APPLY ? 'APPLY (writing)' : 'DRY RUN (read-only)'}\n`);

  let scanned = 0;
  let fixed = 0;
  let lastKey: Record<string, unknown> | undefined;

  do {
    const res = await ddb.send(
      new ScanCommand({
        TableName: USERS_TABLE,
        FilterExpression: 'begins_with(PK, :pk) AND SK = :sk',
        ExpressionAttributeValues: { ':pk': 'USER#', ':sk': 'METADATA' },
        ExclusiveStartKey: lastKey,
      }),
    );

    for (const user of (res.Items || []) as User[]) {
      scanned++;
      if (!user.cognitoSub) {
        console.log(`  ! ${user.email}: no cognitoSub on record — skipped`);
        continue;
      }

      // Read current Cognito attributes to compute a diff.
      let current: Record<string, string> = {};
      try {
        const got = await cognito.send(
          new AdminGetUserCommand({ UserPoolId: userPoolId, Username: user.cognitoSub }),
        );
        current = Object.fromEntries(
          (got.UserAttributes || []).map((a) => [a.Name as string, a.Value as string]),
        );
      } catch (err) {
        console.log(`  ! ${user.email}: Cognito user not found (${(err as Error).name}) — skipped`);
        continue;
      }

      const desired = cognitoClaimsFor(user);
      const drift = desired.filter((a) => current[a.Name] !== a.Value);
      if (drift.length === 0) {
        console.log(`  = ${user.email}: claims already correct`);
        continue;
      }

      fixed++;
      for (const a of drift) {
        console.log(
          `  + ${user.email}: ${a.Name} "${current[a.Name] ?? '(unset)'}" -> "${a.Value}"`,
        );
      }

      if (APPLY) {
        await cognito.send(
          new AdminUpdateUserAttributesCommand({
            UserPoolId: userPoolId,
            Username: user.cognitoSub,
            UserAttributes: desired,
          }),
        );
      }
    }
    lastKey = res.LastEvaluatedKey;
  } while (lastKey);

  console.log(
    `\nDone. Scanned ${scanned} users, ${fixed} need fixes${
      APPLY ? ' (applied)' : ' (dry run — no writes; re-run with --apply)'
    }.`,
  );
  if (APPLY && fixed > 0) {
    console.log('NOTE: affected users must re-login/refresh to pick up the new token claims.');
  }
}

main().catch((err) => {
  console.error('Cognito claim backfill failed:', err);
  process.exit(1);
});
