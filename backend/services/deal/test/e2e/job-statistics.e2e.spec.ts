import { type INestApplication } from '@nestjs/common';
import request from 'supertest';
import { type JwtUser } from '@bitcrm/types';
import { setupApp, teardownApp, createTestUserHeader } from './setup';

/**
 * Job Statistics' authorization, through the real PermissionGuard: like the
 * Jobs report it is gated on `reports.view` (Workiz "Statistics Report"),
 * not on `deals.view` — every seeded role here can view deals and none holds
 * `reports`, so each is refused; no header at all is a 401.
 */
const dispatcherUser: JwtUser = {
  id: 'dispatcher-1', cognitoSub: 'sub-2', email: 'dispatch@test.com',
  roleId: 'role-dispatcher', department: 'Atlanta',
};
const readOnlyUser: JwtUser = {
  id: 'readonly-1', cognitoSub: 'sub-4', email: 'readonly@test.com',
  roleId: 'role-read-only', department: 'HQ',
};

describe('Job Statistics E2E — authorization', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await setupApp();
  });

  afterAll(async () => {
    await teardownApp();
  });

  const url = '/api/deals/report/statistics?from=2026-09-01&to=2026-09-27';

  it('GET without a user is 401', async () => {
    await request(app.getHttpServer()).get(url).expect(401);
  });

  it('GET for a role without reports is 403 — deals.view is not enough', async () => {
    for (const user of [dispatcherUser, readOnlyUser]) {
      await request(app.getHttpServer()).get(url).set('x-test-user', createTestUserHeader(user)).expect(403);
    }
  });
});
