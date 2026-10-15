import { Controller, Get, INestApplication, Module, Param } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AuditModule } from '../../../src/audit/audit.module';
import { AdminAuditRepository } from '../../../src/audit/admin-audit.repository';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

@Controller()
class CatchAllUsersController {
  @Get(':id')
  findById(@Param('id') id: string) {
    return { user: id };
  }
}
@Module({ controllers: [CatchAllUsersController] })
class CatchAllUsersModule {}

/**
 * `GET /api/users/audit` shares its prefix with the users module's
 * `GET /api/users/:id`; whichever registers first wins. AuditModule is
 * imported ahead of UsersModule in AppModule for that reason.
 */
describe('GET /audit route order', () => {
  // Read from the source: loading AppModule itself opens every connection.
  it('AppModule imports AuditModule before every module with a GET /:id', () => {
    const src = readFileSync(join(__dirname, '../../../src/app.module.ts'), 'utf8');
    const list = src.slice(src.indexOf('imports: ['));
    const at = (name: string) => list.search(new RegExp(`^\\s*${name},`, 'm'));
    expect(at('AuditModule')).toBeGreaterThan(-1);
    for (const later of ['SecurityModule', 'TechniciansModule', 'RolesModule', 'UsersModule']) {
      expect(at('AuditModule')).toBeLessThan(at(later));
    }
  });

  describe('served', () => {
    let app: INestApplication;
    beforeAll(async () => {
      const module = await Test.createTestingModule({ imports: [AuditModule, CatchAllUsersModule] })
        .overrideProvider(AdminAuditRepository)
        .useValue({ page: async () => ({ items: [{ id: 'a-1' }] }) })
        .compile();
      app = module.createNestApplication();
      app.setGlobalPrefix('api/users');
      await app.init();
    });
    afterAll(() => app.close());

    it('answers the trail, not a user called "audit"', async () => {
      const res = await request(app.getHttpServer()).get('/api/users/audit').expect(200);
      expect(res.body).toEqual({ success: true, data: [{ id: 'a-1' }], pagination: {} });
    });
  });
});
