import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';

/**
 * Boots the real AppModule against local infra (redis :6379, the throwaway
 * dynamodb-test :8001) and checks the platform surface the skeleton owns:
 * health answers, nothing is reachable without a bearer token.
 *
 *   docker compose --profile test up -d dynamodb-test && docker compose up -d redis
 *   npm run test:e2e -w backend/services/messaging
 */
describe('Messaging app (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    process.env.DYNAMODB_ENDPOINT = 'http://localhost:8001';
    process.env.MESSAGING_TABLE = 'BitCRM_Messaging_Test';
    process.env.REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

    const { createTestTables } = await import('../integration/setup');
    await createTestTables();

    // Imported after env is pinned so the table constant picks it up.
    const { AppModule } = await import('../../src/app.module');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/messaging');
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('answers the health probe', async () => {
    const res = await request(app.getHttpServer()).get('/api/messaging/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });

  it('answers the liveness probe without touching any dependency', async () => {
    const res = await request(app.getHttpServer()).get('/api/messaging/health/live');
    expect(res.status).toBe(200);
  });
});
