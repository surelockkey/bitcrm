import { type INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { HttpExceptionFilter } from '@bitcrm/shared';
import { PushDevicesController } from '../../../src/push/push-devices.controller';
import { PushDevicesRepository } from '../../../src/push/push-devices.repository';
import { TECH } from '../api/api-mocks';

/**
 * The device contract over real HTTP, because the app stream codes against
 * the wire and not against the controller class. Three things only a request
 * can prove, and a direct method call cannot:
 *
 *   * the routes are where the contract says — under the service's
 *     `api/messaging` global prefix, so `POST /api/messaging/devices`;
 *   * `whitelist: true` on the global pipe strips a body field the DTO does
 *     not declare, so a caller who posts `userId` cannot register a phone to
 *     somebody else even by accident;
 *   * an Expo token carries brackets, and percent-encoding it into the DELETE
 *     path segment (which the app must do — `[` is not a legal path
 *     character) arrives back at the repository decoded, character for
 *     character, or the wrong phone is silenced.
 *
 * The guards are AppModule's and global, so they are not in this harness; the
 * caller is put on the request the way `CognitoAuthGuard` would.
 */
const TOKEN = 'ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]';
const PATH = '/api/messaging/devices';
const REGISTERED_AT = '2026-09-17T09:00:00.000Z';

describe('Push device registry (HTTP)', () => {
  let app: INestApplication;
  const register = jest.fn();
  const removeForUser = jest.fn();

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [PushDevicesController],
      providers: [{ provide: PushDevicesRepository, useValue: { register, removeForUser } }],
    }).compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/messaging');
    // What the global CognitoAuthGuard leaves behind for `@CurrentUser()`.
    app.use((req: Record<string, unknown>, _res: unknown, next: () => void) => {
      req.user = TECH;
      next();
    });
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    register.mockReset().mockImplementation(async (input: Record<string, unknown>) => ({
      ...input,
      registeredAt: REGISTERED_AT,
      lastSeenAt: REGISTERED_AT,
    }));
    removeForUser.mockReset().mockResolvedValue(true);
  });

  describe(`POST ${PATH}`, () => {
    it('answers 201 and the contract body, for the caller in the bearer token', async () => {
      const res = await request(app.getHttpServer())
        .post(PATH)
        .send({ token: TOKEN, platform: 'ios', appVersion: '1.4.0', deviceName: "Ihor's iPhone" });

      // 201, not 200 — Nest's default for a POST, and what the app has to accept.
      expect(res.status).toBe(201);
      expect(res.body).toEqual({ success: true, data: { token: TOKEN, registeredAt: REGISTERED_AT } });
      expect(register).toHaveBeenCalledWith({
        token: TOKEN,
        userId: TECH.id,
        platform: 'ios',
        appVersion: '1.4.0',
        deviceName: "Ihor's iPhone",
      });
    });

    it('drops a body field the DTO does not declare, so nobody can name another user', async () => {
      const res = await request(app.getHttpServer())
        .post(PATH)
        .send({ token: TOKEN, platform: 'android', userId: 'someone-else', registeredAt: '1999-01-01T00:00:00.000Z' });

      expect(res.status).toBe(201);
      // The pipe whitelisted them away before the handler ever saw them.
      expect(register).toHaveBeenCalledWith({
        token: TOKEN,
        userId: TECH.id,
        platform: 'android',
        appVersion: undefined,
        deviceName: undefined,
      });
      expect(res.body.data.registeredAt).toBe(REGISTERED_AT);
    });

    it('refuses a platform we cannot push to, and a missing token, without touching the registry', async () => {
      for (const body of [{ token: TOKEN, platform: 'web' }, { platform: 'ios' }, { token: '', platform: 'ios' }]) {
        const res = await request(app.getHttpServer()).post(PATH).send(body);
        expect(res.status).toBe(400);
      }
      expect(register).not.toHaveBeenCalled();
    });
  });

  describe(`DELETE ${PATH}/:token`, () => {
    it('decodes a percent-encoded Expo token back to its brackets', async () => {
      const res = await request(app.getHttpServer()).delete(`${PATH}/${encodeURIComponent(TOKEN)}`);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: true, data: { token: TOKEN } });
      expect(removeForUser).toHaveBeenCalledWith(TOKEN, TECH.id);
    });

    it('answers the same for a token that is gone or was never the caller — this phone must stop either way', async () => {
      removeForUser.mockResolvedValue(false);

      const res = await request(app.getHttpServer()).delete(`${PATH}/${encodeURIComponent(TOKEN)}`);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: true, data: { token: TOKEN } });
    });
  });
});
