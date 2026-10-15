/**
 * Backfill: Track location ON on every technician card that has it off —
 * once, when "on by default" ships (owner, 2026-10-15). `planGpsDefaultOn`
 * decides, this file reads and writes.
 *
 * RUN IT ONCE. Until 2026-10-14 the flag was read by nothing, so today's
 * "off" values are the old default; from now on an "off" is a manager's
 * choice, and running this again would undo it.
 *
 * Reads the users table with one Scan (METADATA + TECH_PROFILE rows), writes
 * `gpsTrackingEnabled = true` on each card the plan picks. Subcontractors are
 * never touched. Cached profiles in Redis refresh within the cache TTL.
 *
 *   npm run backfill:gps-default-on -w backend/services/user              # dry run
 *   npm run backfill:gps-default-on -w backend/services/user -- --apply   # write
 *
 * Env: USERS_TABLE, AWS_REGION, optional DYNAMODB_ENDPOINT.
 */
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(__dirname, '../../../../.env') });
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import type { TechnicianProfile, User } from '@bitcrm/types';
import { planGpsDefaultOn } from '../users/gps-default-on-backfill';

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

  console.log(`Backfill Track location ON — table=${USERS_TABLE} region=${region}`);
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

  let picked = 0;
  let failed = 0;
  for (const [id, card] of cards) {
    const user = users.get(id) ?? {};
    if (!planGpsDefaultOn({ userType: (user as Partial<User>).userType }, card)) continue;
    picked++;
    const u = user as Partial<User> & Record<string, unknown>;
    const name = (u.workizName as string | undefined) ?? `${u.firstName ?? ''} ${u.lastName ?? ''}`.trim();
    console.log(`  card  ${id} ${name || '(no user record)'}: Track location := on`);
    if (!APPLY) continue;
    try {
      await doc.send(
        new UpdateCommand({
          TableName: USERS_TABLE,
          Key: { PK: `USER#${id}`, SK: 'TECH_PROFILE' },
          UpdateExpression: 'SET gpsTrackingEnabled = :on, updatedAt = :now',
          ConditionExpression: 'attribute_exists(PK)',
          ExpressionAttributeValues: { ':on': true, ':now': new Date().toISOString() },
        }),
      );
    } catch (err) {
      failed++;
      console.error(`  FAIL  ${id}: ${(err as Error).name}: ${(err as Error).message}`);
    }
  }

  console.log(`\nDone. ${cards.size} cards — ${APPLY ? 'turned on' : 'to turn on'} ${picked}, failed ${failed}.`);
  if (failed) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
