/**
 * Backfill: Workiz's "User type" (User | Subcontractor) on the user record, and
 * what goes with it — `planUserTypeBackfill` decides, this file reads and writes.
 *
 * Run after the deploy that ships `User.userType`, and after every Workiz users
 * import or `bitcrm-patch-user-type` (workiz-data-parser), which write the type:
 *
 * - a type set only on the technician card (the old form) moves onto the user;
 * - the card's copy is brought in step, and a subcontractor's location tracking
 *   goes off;
 * - every subcontractor's Cognito account is switched off (AdminDisableUser,
 *   idempotent) — a subcontractor cannot sign in.
 *
 * Reads the users table with one Scan (METADATA + TECH_PROFILE rows only; the
 * table holds a few thousand rows). Idempotent: a second run changes nothing.
 *
 *   npm run backfill:user-type -w backend/services/user              # dry run
 *   npm run backfill:user-type -w backend/services/user -- --apply   # write
 *
 * Env: USERS_TABLE, AWS_REGION, COGNITO_USER_POOL_ID (for --apply), optional
 * DYNAMODB_ENDPOINT. Sessions already open end when their id token expires
 * (≤ 1 h); a refresh is refused by Cognito once the account is off.
 */
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(__dirname, '../../../../.env') });

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import {
  AdminDisableUserCommand,
  CognitoIdentityProviderClient,
} from '@aws-sdk/client-cognito-identity-provider';
import type { TechnicianProfile, User } from '@bitcrm/types';
import { planUserTypeBackfill } from '../users/user-type-backfill';

const USERS_TABLE = process.env.USERS_TABLE || 'BitCRM_Users';
const APPLY = process.argv.includes('--apply');

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
  const pool = process.env.COGNITO_USER_POOL_ID;
  if (APPLY && !pool) throw new Error('COGNITO_USER_POOL_ID is required with --apply');
  const cognito = new CognitoIdentityProviderClient({ region });

  console.log(`Backfill user type — table=${USERS_TABLE} region=${region}`);
  console.log(`Mode: ${APPLY ? 'APPLY' : 'DRY RUN (pass --apply to write)'}\n`);

  const users = new Map<string, User & Record<string, unknown>>();
  const cards = new Map<string, TechnicianProfile>();
  let lastKey: Record<string, unknown> | undefined;
  do {
    const res = await doc.send(
      new ScanCommand({
        TableName: USERS_TABLE,
        FilterExpression: 'begins_with(PK, :u) AND (SK = :m OR SK = :p)',
        ExpressionAttributeValues: { ':u': 'USER#', ':m': 'METADATA', ':p': 'TECH_PROFILE' },
        ExclusiveStartKey: lastKey,
      }),
    );
    for (const item of res.Items ?? []) {
      const id = String(item.PK).slice('USER#'.length);
      if (item.SK === 'METADATA') users.set(id, item as User & Record<string, unknown>);
      else cards.set(id, item as TechnicianProfile);
    }
    lastKey = res.LastEvaluatedKey;
  } while (lastKey);

  const count = { subcontractors: 0, setUserType: 0, card: 0, signInOff: 0, failed: 0 };
  for (const [id, user] of users) {
    const plan = planUserTypeBackfill({ id, userType: user.userType }, cards.get(id));
    if (plan.type === 'subcontractor') count.subcontractors++;
    const name = (user.workizName as string | undefined) ?? `${user.firstName} ${user.lastName}`;
    try {
      if (plan.setUserType) {
        count.setUserType++;
        console.log(`  user  ${id} ${name}: userType := ${plan.setUserType} (from the card)`);
        if (APPLY) {
          await doc.send(
            new UpdateCommand({
              TableName: USERS_TABLE,
              Key: { PK: `USER#${id}`, SK: 'METADATA' },
              UpdateExpression: 'SET userType = :t, updatedAt = :now',
              ConditionExpression: 'attribute_exists(PK) AND attribute_not_exists(userType)',
              ExpressionAttributeValues: { ':t': plan.setUserType, ':now': new Date().toISOString() },
            }),
          );
        }
      }
      if (plan.card) {
        count.card++;
        console.log(`  card  ${id} ${name}: ${JSON.stringify(plan.card)}`);
        if (APPLY) {
          const sets = ['technicianType = :t', 'updatedAt = :now'];
          const values: Record<string, unknown> = { ':t': plan.card.technicianType, ':now': new Date().toISOString() };
          if (plan.card.gpsTrackingEnabled === false) {
            sets.push('gpsTrackingEnabled = :gps');
            values[':gps'] = false;
          }
          await doc.send(
            new UpdateCommand({
              TableName: USERS_TABLE,
              Key: { PK: `USER#${id}`, SK: 'TECH_PROFILE' },
              UpdateExpression: `SET ${sets.join(', ')}`,
              ConditionExpression: 'attribute_exists(PK)',
              ExpressionAttributeValues: values,
            }),
          );
        }
      }
      if (plan.disableSignIn) {
        count.signInOff++;
        const username = (user.cognitoSub as string | undefined) || (user.email as string);
        if (APPLY) {
          await cognito.send(new AdminDisableUserCommand({ UserPoolId: pool, Username: username }));
        } else {
          console.log(`  login ${id} ${name}: Cognito account off (${username})`);
        }
      }
    } catch (err) {
      count.failed++;
      console.error(`  FAIL  ${id} ${name}: ${(err as Error).name}: ${(err as Error).message}`);
    }
  }

  console.log(
    `\nDone. ${users.size} users, ${count.subcontractors} subcontractors — user type ${
      APPLY ? 'set' : 'to set'
    } ${count.setUserType}, cards ${APPLY ? 'fixed' : 'to fix'} ${count.card}, sign-ins ${
      APPLY ? 'switched off' : 'to switch off'
    } ${count.signInOff}, failed ${count.failed}.`,
  );
  if (count.failed) process.exit(1);
}

main().catch((err) => {
  console.error('User type backfill failed:', err);
  process.exit(1);
});
