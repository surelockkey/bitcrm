import { type INestApplication } from '@nestjs/common';
import request from 'supertest';
import { type JwtUser } from '@bitcrm/types';
import {
  setupApp,
  teardownApp,
  cleanupData,
  createTestUserHeader,
  seedUser,
} from './setup';

// Route all repositories at the shared test table (the PermissionGuard reads roles).
jest.mock('../../src/users/constants/dynamo.constants', () => ({
  USERS_TABLE: 'BitCRM_Users_Test',
  GSI1_NAME: 'RoleIndex',
  GSI2_NAME: 'DepartmentIndex',
}));
jest.mock('../../src/roles/constants/dynamo.constants', () => ({
  ROLES_TABLE: 'BitCRM_Users_Test',
  ROLES_GSI1_NAME: 'RoleIndex',
}));
jest.mock('../../src/technicians/constants/dynamo.constants', () => ({
  TECHNICIANS_TABLE: 'BitCRM_Users_Test',
  GSI3_NAME: 'TechnicianIndex',
  TECHNICIAN_GSI_PK: 'TECHNICIAN',
  PROFILE_SK: 'TECH_PROFILE',
  JOB_TYPE_SK_PREFIX: 'JOBTYPE#',
  SERVICE_AREA_SK_PREFIX: 'AREA#',
  GSI4_NAME: 'SkillStatusIndex',
  jobTypeStatusGsiPk: (s: string) => `JOBTYPE_STATUS#${s}`,
  serviceAreaStatusGsiPk: (s: string) => `AREA_STATUS#${s}`,
  COMMISSION_SK_PREFIX: 'COMMISSION#',
  CLOCK_SK_PREFIX: 'CLOCK#',
  clockSk: (startedAt: string, id: string) => `CLOCK#${startedAt}#${id}`,
  CLOCK_OPEN_SK: 'CLOCK_OPEN',
  trackPk: (userId: string) => `TRACK#${userId}`,
  TRACK_TTL_ATTRIBUTE: 'expiresAt',
  TRACK_TTL_DAYS: 30,
}));

const BASE = '/api/users/timeclock';

const tech: JwtUser = {
  id: 'tech-1', cognitoSub: 'c', email: 't@t.com', roleId: 'role-technician', department: 'HVAC',
};
const otherTech: JwtUser = {
  id: 'tech-2', cognitoSub: 'c', email: 't2@t.com', roleId: 'role-technician', department: 'HVAC',
};
const dispatcher: JwtUser = {
  id: 'disp-1', cognitoSub: 'c', email: 'd@t.com', roleId: 'role-dispatcher', department: 'HVAC',
};

describe('Time Clock (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => { app = await setupApp(); });
  afterAll(async () => { await teardownApp(); });
  afterEach(async () => { await cleanupData(); });

  const start = (as: JwtUser, body: Record<string, unknown> = { source: 'mobile' }) =>
    request(app.getHttpServer())
      .post(`${BASE}/start`)
      .set('x-test-user', createTestUserHeader(as))
      .send(body);

  const stop = (as: JwtUser, body: Record<string, unknown> = {}) =>
    request(app.getHttpServer())
      .post(`${BASE}/stop`)
      .set('x-test-user', createTestUserHeader(as))
      .send(body);

  it('clocks a technician in and stamps the start on the server', async () => {
    const res = await start(tech).expect(201);

    expect(res.body.data).toMatchObject({ userId: 'tech-1', source: 'mobile' });
    expect(res.body.data.startedAt).toEqual(expect.any(String));
    expect(res.body.data.endedAt).toBeUndefined();
  });

  it('clocks in without coordinates — a refused location permission is not a blocker', async () => {
    const res = await start(tech).expect(201);
    expect(res.body.data.startLocation).toBeUndefined();
  });

  it('keeps the coordinates and their accuracy', async () => {
    const res = await start(tech, {
      source: 'mobile', lat: 33.749, lng: -84.388, accuracy: 12,
    }).expect(201);

    expect(res.body.data.startLocation).toEqual({ lat: 33.749, lng: -84.388, accuracy: 12 });
  });

  it('rejects out-of-range coordinates', async () => {
    await start(tech, { source: 'mobile', lat: 999, lng: -84.388 }).expect(400);
  });

  it('rejects an unknown source', async () => {
    await start(tech, { source: 'smoke-signal' }).expect(400);
  });

  it('requires authentication', async () => {
    await request(app.getHttpServer()).post(`${BASE}/start`).send({ source: 'mobile' }).expect(401);
  });

  // The honest answer: refuse. The body is the service-wide error envelope —
  // `HttpExceptionFilter` renders `{ success, error: { code, message } }` and
  // drops every other field — so the running entry cannot ride the 409 and the
  // app reads it back from /current, as the next test does.
  it('answers a second start with a 409 envelope', async () => {
    await start(tech).expect(201);
    const second = await start(tech).expect(409);

    expect(second.body).toEqual({
      success: false,
      error: { code: 'CONFLICT', message: 'You are already clocked in' },
    });
  });

  it('leaves the first shift running and readable after that 409', async () => {
    const first = await start(tech).expect(201);
    await start(tech).expect(409);

    const running = await request(app.getHttpServer())
      .get(`${BASE}/current`)
      .set('x-test-user', createTestUserHeader(tech))
      .expect(200);

    expect(running.body.data.id).toBe(first.body.data.id);
    expect(running.body.data.startedAt).toBe(first.body.data.startedAt);
  });

  it('reports the running entry, and null when there is none', async () => {
    const before = await request(app.getHttpServer())
      .get(`${BASE}/current`)
      .set('x-test-user', createTestUserHeader(tech))
      .expect(200);
    expect(before.body.data).toBeNull();

    await start(tech).expect(201);

    const after = await request(app.getHttpServer())
      .get(`${BASE}/current`)
      .set('x-test-user', createTestUserHeader(tech))
      .expect(200);
    expect(after.body.data.userId).toBe('tech-1');
  });

  it('sees only its own clock, never a colleague’s', async () => {
    await start(otherTech).expect(201);

    const res = await request(app.getHttpServer())
      .get(`${BASE}/current`)
      .set('x-test-user', createTestUserHeader(tech))
      .expect(200);
    expect(res.body.data).toBeNull();
  });

  // Workiz's own rule (help 18055805122065); the message has to read like English.
  it('refuses a clock-out inside the first minute', async () => {
    await start(tech).expect(201);

    const res = await stop(tech).expect(400);
    expect(res.body.error.message).toContain('at least one minute');
  });

  it('answers a clock-out with nothing running as 409, not 500', async () => {
    const res = await stop(tech).expect(409);
    expect(res.body.error.message).toBe('You are not clocked in');
  });

  // A second stop for the same shift takes the same 409 path — the slot is gone
  // either way. The two-writers-at-once version of it is pinned in the unit
  // tests, where the race can be produced without a real minute passing.

  it('keeps the shift open after a refused clock-out', async () => {
    await start(tech).expect(201);
    await stop(tech).expect(400);

    const res = await request(app.getHttpServer())
      .get(`${BASE}/current`)
      .set('x-test-user', createTestUserHeader(tech))
      .expect(200);
    expect(res.body.data).not.toBeNull();
  });

  it('lists a technician’s own timesheet for a range', async () => {
    await start(tech).expect(201);
    const today = new Date().toISOString().slice(0, 10);

    const res = await request(app.getHttpServer())
      .get(`${BASE}?from=${today}&to=${today}`)
      .set('x-test-user', createTestUserHeader(tech))
      .expect(200);

    expect(res.body.data.entries).toHaveLength(1);
    // The open shift contributes nothing yet.
    expect(res.body.data.totalMinutes).toBe(0);
  });

  // An offset instant is what a report built in a US timezone sends. The bound
  // has to be re-stamped as UTC before it becomes a sort key, or the query
  // brackets the wrong hours.
  it('finds today’s shift through a range given with a UTC offset', async () => {
    await start(tech).expect(201);
    const now = new Date();
    const from = new Date(now.getTime() - 12 * 3_600_000)
      .toISOString()
      .replace('Z', '+00:00');
    const to = new Date(now.getTime() + 12 * 3_600_000)
      .toISOString()
      .replace('Z', '+00:00');

    const res = await request(app.getHttpServer())
      .get(`${BASE}?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`)
      .set('x-test-user', createTestUserHeader(tech))
      .expect(200);

    expect(res.body.data.entries).toHaveLength(1);
  });

  it('refuses a backwards range with 400 rather than a 500 from the table', async () => {
    await request(app.getHttpServer())
      .get(`${BASE}?from=2026-09-21&to=2026-09-15`)
      .set('x-test-user', createTestUserHeader(tech))
      .expect(400);
  });

  it('refuses one technician reading another’s hours', async () => {
    await seedUser(tech);
    const today = new Date().toISOString().slice(0, 10);

    await request(app.getHttpServer())
      .get(`${BASE}?from=${today}&to=${today}&userId=tech-2`)
      .set('x-test-user', createTestUserHeader(tech))
      .expect(403);
  });

  it('lets a dispatcher read a technician’s hours', async () => {
    await seedUser(dispatcher);
    await start(tech).expect(201);
    const today = new Date().toISOString().slice(0, 10);

    const res = await request(app.getHttpServer())
      .get(`${BASE}?from=${today}&to=${today}&userId=tech-1`)
      .set('x-test-user', createTestUserHeader(dispatcher))
      .expect(200);

    expect(res.body.data.entries).toHaveLength(1);
  });

  it('requires a range', async () => {
    await request(app.getHttpServer())
      .get(BASE)
      .set('x-test-user', createTestUserHeader(tech))
      .expect(400);
  });
});
