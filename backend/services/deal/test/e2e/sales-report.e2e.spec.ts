import { type INestApplication } from '@nestjs/common';
import request from 'supertest';
import { type JwtUser } from '@bitcrm/types';
import { setupApp, teardownApp, createTestUserHeader } from './setup';

/**
 * The Sales report's authorization, through the real PermissionGuard: it is
 * gated on `reports.view` (Workiz "Sales Report"), not on `deals.view` —
 * every seeded role here can view deals and none holds `reports`, so each is
 * refused; no header at all is a 401. Saving the account's columns is
 * `reports.edit`. The same shape as the Jobs report's.
 */
const dispatcherUser: JwtUser = {
  id: 'dispatcher-1', cognitoSub: 'sub-2', email: 'dispatch@test.com',
  roleId: 'role-dispatcher', department: 'Atlanta',
};
const readOnlyUser: JwtUser = {
  id: 'readonly-1', cognitoSub: 'sub-4', email: 'readonly@test.com',
  roleId: 'role-read-only', department: 'HQ',
};

describe('Sales report E2E — authorization', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await setupApp();
  });

  afterAll(async () => {
    await teardownApp();
  });

  const routes: [string, string][] = [
    ['get', '/api/deals/report/sales?from=2026-09-01&to=2026-09-27'],
    ['get', '/api/deals/report/sales/export?from=2026-09-01&to=2026-09-27'],
    ['get', '/api/deals/report/sales/settings'],
    ['put', '/api/deals/report/sales/settings'],
  ];

  it.each(routes)('%s %s without a user is 401', async (method, url) => {
    await (request(app.getHttpServer()) as any)[method](url).expect(401);
  });

  it.each(routes)('%s %s for a role without reports is 403 — deals.view is not enough', async (method, url) => {
    for (const user of [dispatcherUser, readOnlyUser]) {
      await (request(app.getHttpServer()) as any)[method](url).set('x-test-user', createTestUserHeader(user)).send({ columns: ['jobNumber'] }).expect(403);
    }
  });
});
