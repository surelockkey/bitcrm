/**
 * The report's authorization through a real Nest app — the real
 * PermissionGuard and ValidationPipe, a header-based auth guard as in e2e,
 * and permissions from an in-memory cache instead of Redis. Needs no Docker.
 */
import {
  CanActivate,
  ExecutionContext,
  INestApplication,
  Injectable,
  UnauthorizedException,
  ValidationPipe,
} from '@nestjs/common';
import { APP_GUARD, Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { HttpExceptionFilter, PermissionCacheReader, PermissionGuard } from '@bitcrm/shared';
import type { JwtUser } from '@bitcrm/types';
import { CommissionReportController } from 'src/commission-report/commission-report.controller';
import { CommissionReportService } from 'src/commission-report/commission-report.service';

@Injectable()
class HeaderAuthGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    const header = req.headers['x-test-user'];
    if (!header) throw new UnauthorizedException();
    req.user = JSON.parse(header as string);
    return true;
  }
}

const ROLES: Record<string, unknown> = {
  'role-admin': { permissions: { commission: { view: true, edit: true } }, dataScope: { commission: 'all' } },
  'role-technician': { permissions: { commission: { view: true } }, dataScope: { commission: 'assigned_only' } },
  'role-dispatcher': { permissions: { commission: { view: false } }, dataScope: { commission: 'department' } },
};

const user = (id: string, roleId: string): JwtUser => ({ id, cognitoSub: id, email: `${id}@t.com`, roleId, department: 'HQ' });
const as = (u: JwtUser) => ['x-test-user', JSON.stringify(u)] as const;

describe('GET /api/deals/reports/commissions — authorization', () => {
  let app: INestApplication;
  const service = {
    report: jest.fn().mockResolvedValue({ count: 0, rows: [] }),
    exportCsv: jest.fn().mockResolvedValue({ filename: 'c.csv', csv: 'Job Id' }),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [CommissionReportController],
      providers: [
        { provide: CommissionReportService, useValue: service },
        { provide: PermissionCacheReader, useValue: { getPermissions: async (_: string, roleId: string) => ROLES[roleId] ?? null } },
        { provide: APP_GUARD, useClass: HeaderAuthGuard },
        { provide: APP_GUARD, useClass: PermissionGuard },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/deals');
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();
  });

  afterAll(async () => app.close());
  beforeEach(() => jest.clearAllMocks());

  const URL = '/api/deals/reports/commissions?from=2026-09-01&to=2026-09-27';

  it('requires auth (401)', async () => {
    await request(app.getHttpServer()).get(URL).expect(401);
    await request(app.getHttpServer()).get(`${URL.replace('?', '/export?')}`).expect(401);
  });

  it('refuses a role without commission.view (403)', async () => {
    await request(app.getHttpServer()).get(URL).set(...as(user('d-1', 'role-dispatcher'))).expect(403);
    await request(app.getHttpServer()).get(URL.replace('?', '/export?')).set(...as(user('d-1', 'role-dispatcher'))).expect(403);
    expect(service.report).not.toHaveBeenCalled();
  });

  it('lets the office in with its scope and the declared query', async () => {
    const res = await request(app.getHttpServer())
      .get(`${URL}&mode=tech&techId=t-1&by=scheduled&junk=1`)
      .set(...as(user('a-1', 'role-admin')))
      .expect(200);
    expect(res.body).toEqual({ success: true, data: { count: 0, rows: [] } });
    const [query, caller, scope] = service.report.mock.calls[0];
    expect(query).toMatchObject({ from: '2026-09-01', to: '2026-09-27', mode: 'tech', techId: 't-1', by: 'scheduled' });
    expect(query).not.toHaveProperty('junk');
    expect(caller.id).toBe('a-1');
    expect(scope).toBe('all');
  });

  it('a technician gets in with assigned_only (the service narrows to their own jobs)', async () => {
    await request(app.getHttpServer()).get(URL).set(...as(user('t-1', 'role-technician'))).expect(200);
    expect(service.report.mock.calls[0][2]).toBe('assigned_only');
  });

  it('rejects a malformed day or mode (400)', async () => {
    await request(app.getHttpServer()).get('/api/deals/reports/commissions?from=09/01/2026').set(...as(user('a-1', 'role-admin'))).expect(400);
    await request(app.getHttpServer()).get(`${URL}&mode=everything`).set(...as(user('a-1', 'role-admin'))).expect(400);
  });

  it('exports CSV as an attachment', async () => {
    const res = await request(app.getHttpServer()).get(URL.replace('?', '/export?')).set(...as(user('a-1', 'role-admin'))).expect(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.headers['content-disposition']).toBe('attachment; filename="c.csv"');
    expect(res.text).toBe('﻿Job Id');
  });
});
