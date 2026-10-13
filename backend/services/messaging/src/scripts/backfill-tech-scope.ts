/**
 * Build (and reconcile) the stored technician inbox scope, then open its gate.
 *
 * WHY
 * ---
 * An `assigned_only` caller's inbox (`GET /messaging/conversations`) used to
 * ask deal-service for the technician's jobs on every request. Phase C (C4)
 * stores that answer per technician (`TECHSCOPE` / `USER#<userId>`, see
 * `TechScopeService`) and keeps it current from job events. Reads use the
 * rows only once `TECHSCOPEINDEX / STATE` exists — this script writes it.
 *
 * WHAT
 * ----
 * For every user user-service lists (`GET /api/users/internal/all`) and every
 * row that already exists: a fresh `GET /api/deals/internal/by-tech/:id`,
 * the same roster filter the live path applies, and the row written when it
 * differs. Rows of users no longer listed are deleted (a derived projection
 * reconciles — CLAUDE.md §5). Users with no job and no row get no row (the
 * first inbox read makes one). The gate is stamped only with `--apply` and
 * only when deal-service answered for every user; otherwise re-run it.
 *
 * Idempotent: a second run finds everything unchanged. Safe while live: every
 * write is guarded on the row's `computedAt`, so a job event processed
 * meanwhile is never overwritten by an older read.
 *
 * USAGE
 * -----
 *   npm run backfill:tech-scope -w backend/services/messaging               # dry run: counts only
 *   npm run backfill:tech-scope -w backend/services/messaging -- --apply    # write + open the gate
 *
 *   against dev (deal / user reachable at their internal URLs, the internal secret set):
 *   AWS_PROFILE=bitcrm-dev DYNAMODB_ENDPOINT= MESSAGING_TABLE=bitcrm-dev-messaging \
 *   DEAL_SERVICE_URL=… USER_SERVICE_URL=… INTERNAL_SERVICE_SECRET=… \
 *     npm run backfill:tech-scope -w backend/services/messaging -- --apply
 *
 * Run it after the deploy that ships C4 (the job-event handlers must already
 * be live, so nothing between the read and the gate is missed — and if one
 * is, the rows' 15-minute max age rebuilds it), and again whenever the rows
 * are suspected of drift. A Workiz import of jobs needs it too: imported
 * assignments publish no events.
 */
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(__dirname, '../../../../.env') });

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { type DynamoDbService } from '@bitcrm/shared';
import { DealReadService } from '../api/access/deal-read.service';
import { MESSAGING_TABLE } from '../common/constants/dynamo.constants';
import { TechScopeRepository } from '../tech-scope/tech-scope.repository';
import { TechScopeService } from '../tech-scope/tech-scope.service';

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

/** Every user id user-service knows, paged. Throws when it cannot answer — nothing is reconciled against half a list. */
async function listUserIds(): Promise<string[]> {
  const base = process.env.USER_SERVICE_URL || 'http://localhost:4001';
  const ids: string[] = [];
  let cursor: string | undefined;
  do {
    const qs = `limit=500${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
    const res = await fetch(`${base}/api/users/internal/all?${qs}`, {
      headers: { 'x-internal-secret': process.env.INTERNAL_SERVICE_SECRET || '' },
    });
    if (!res.ok) throw new Error(`user-service answered ${res.status} for the user list`);
    const body = (await res.json()) as { data?: { items?: Array<{ id: string }>; nextCursor?: string } };
    for (const u of body.data?.items ?? []) if (u?.id) ids.push(u.id);
    cursor = body.data?.nextCursor;
  } while (cursor);
  return ids;
}

async function main(): Promise<void> {
  console.log(`backfill:tech-scope on ${MESSAGING_TABLE}${APPLY ? '' : ' (dry run; --apply writes)'}`);
  const repo = new TechScopeRepository({ client } as unknown as DynamoDbService);
  const service = new TechScopeService(repo, new DealReadService());

  const userIds = await listUserIds();
  console.log(`  ${userIds.length} user(s) listed by user-service`);
  const stats = await service.rebuild(userIds, { apply: APPLY });
  console.log(
    `  written ${stats.written}, unchanged ${stats.unchanged}, skipped (no jobs) ${stats.skipped}, ` +
      `removed ${stats.removed}, failed ${stats.failed}`,
  );
  if (APPLY) {
    console.log(
      stats.stateStamped
        ? '  TECHSCOPEINDEX / STATE stamped — technician inboxes now read the stored scope'
        : '  gate NOT stamped (failures above) — re-run once deal-service answers for every user',
    );
  }
  if (stats.failed) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
