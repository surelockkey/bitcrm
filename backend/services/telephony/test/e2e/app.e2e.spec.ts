import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';

/**
 * Boots the real AppModule against local infra (redis :6379, dynamo :8000 via
 * docker compose) with signature validation off, and exercises the public
 * webhook surface + auth gating end-to-end.
 */
describe('Telephony app (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    process.env.TWILIO_VALIDATE_SIGNATURE = 'false';
    process.env.TELEPHONY_DB_SETUP = 'false'; // schema created below
    // Isolated table on the throwaway dynamodb-test instance — the webhook
    // tests write real call records and must never pollute BitCRM_Calls.
    process.env.DYNAMODB_ENDPOINT = 'http://localhost:8001';
    process.env.CALLS_TABLE = 'BitCRM_Calls_Test';
    process.env.REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

    const { createTestTables } = await import('../integration/setup');
    await createTestTables();

    // Imported after env is pinned so config snapshots pick it up.
    const { AppModule } = await import('../../src/app.module');
    const { PresenceService } = await import(
      '../../src/presence/presence.service'
    );
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      // Presence is backed by the shared local redis, where a real dev agent
      // may genuinely be online — pin it empty so the no-agents path is
      // deterministic (and no real Twilio ring legs are ever attempted).
      .overrideProvider(PresenceService)
      .useValue({
        listOnline: async () => [],
        setOnline: async () => undefined,
        setOffline: async () => undefined,
      })
      .compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/telephony');
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('answers the inbound webhook with TwiML (no agents online path)', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/telephony/voice/inbound')
      .type('form')
      .send({ CallSid: 'CAe2e-nobody', From: '+15550001111', To: '+15552223333' });

    expect(res.status).toBe(201);
    expect(res.headers['content-type']).toContain('text/xml');
    expect(res.text).toContain('<Response>');
    expect(res.text).toContain('no agents are available');
  });

  it('answers the status webhook with an empty TwiML response', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/telephony/voice/status')
      .type('form')
      .send({ CallSid: 'CAe2e-status', CallStatus: 'completed' });
    expect(res.status).toBe(201);
    expect(res.text).toContain('<Response/>');
  });

  it('rejects protected endpoints without a bearer token', async () => {
    const recent = await request(app.getHttpServer()).get(
      '/api/telephony/calls/recent',
    );
    expect(recent.status).toBe(401);

    const numbers = await request(app.getHttpServer()).get(
      '/api/telephony/numbers',
    );
    expect(numbers.status).toBe(401);
  });
});
