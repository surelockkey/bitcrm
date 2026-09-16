import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import twilio from 'twilio';
import { HttpExceptionFilter, TWILIO_CONFIG } from '@bitcrm/shared';
import { InboundWebhookController } from '../../../src/webhooks/inbound.controller';
import { FallbackWebhookController } from '../../../src/webhooks/fallback.controller';
import { InboundService } from '../../../src/inbound/inbound.service';
import { FallbackCaptureService } from '../../../src/inbound/fallback-capture.service';

const AUTH_TOKEN = 'the-auth-token';
const PUBLIC_BASE_URL = 'https://api.example.test';
const INBOUND_PATH = '/api/messaging/webhooks/twilio/inbound';
const FALLBACK_PATH = '/api/messaging/webhooks/twilio/fallback';

const form = (over: Record<string, string> = {}) => ({
  MessageSid: 'SM1',
  AccountSid: 'AC00000000000000000000000000000000',
  From: '+14045551234',
  To: '+15550001111',
  Body: 'Hello',
  NumMedia: '0',
  ...over,
});

/** Twilio signs the public URL nginx received, over the sorted form fields. */
const sign = (path: string, body: Record<string, string>, token = AUTH_TOKEN) =>
  twilio.getExpectedTwilioSignature(token, `${PUBLIC_BASE_URL}${path}`, body);

describe('Twilio inbound webhooks (HTTP)', () => {
  let app: INestApplication;
  const ingest = jest.fn();
  const capture = jest.fn();

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [InboundWebhookController, FallbackWebhookController],
      providers: [
        {
          provide: TWILIO_CONFIG,
          useValue: {
            accountSid: 'AC00000000000000000000000000000000',
            authToken: AUTH_TOKEN,
            publicBaseUrl: PUBLIC_BASE_URL,
            validateSignature: true,
          },
        },
        { provide: InboundService, useValue: { ingest } },
        { provide: FallbackCaptureService, useValue: { capture } },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/messaging');
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    ingest.mockReset().mockResolvedValue({ outcome: 'stored', conversationId: 'c1', messageId: 'm1', conversationCreated: false, mediaQueued: 0 });
    capture.mockReset().mockResolvedValue({ s3Key: 'k', queued: true });
  });

  describe('POST /webhooks/twilio/inbound', () => {
    it('rejects a missing or wrong signature with 403 and never touches the pipeline', async () => {
      const body = form();
      const unsigned = await request(app.getHttpServer()).post(INBOUND_PATH).type('form').send(body);
      expect(unsigned.status).toBe(403);

      const forged = await request(app.getHttpServer())
        .post(INBOUND_PATH)
        .set('X-Twilio-Signature', sign(INBOUND_PATH, body, 'somebody-elses-token'))
        .type('form')
        .send(body);
      expect(forged.status).toBe(403);
      expect(forged.body).toMatchObject({ success: false });
      expect(ingest).not.toHaveBeenCalled();
    });

    it('rejects a signature over a tampered body', async () => {
      const body = form();
      const res = await request(app.getHttpServer())
        .post(INBOUND_PATH)
        .set('X-Twilio-Signature', sign(INBOUND_PATH, body))
        .type('form')
        .send({ ...body, Body: 'changed' });
      expect(res.status).toBe(403);
    });

    it('stores a signed message and answers empty TwiML', async () => {
      const body = form({ NumMedia: '1', MediaUrl0: 'https://api.twilio.com/x/Media/ME0123456789abcdef0123456789abcdef', MediaContentType0: 'image/jpeg' });
      const res = await request(app.getHttpServer())
        .post(INBOUND_PATH)
        .set('X-Twilio-Signature', sign(INBOUND_PATH, body))
        .type('form')
        .send(body);

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/^text\/xml/);
      expect(res.text).toBe('<Response/>');
      expect(ingest).toHaveBeenCalledWith(
        expect.objectContaining({
          providerSid: 'SM1',
          from: '+14045551234',
          to: '+15550001111',
          body: 'Hello',
          media: [expect.objectContaining({ contentType: 'image/jpeg', providerMediaSid: 'ME0123456789abcdef0123456789abcdef' })],
        }),
        { source: 'webhook' },
      );
    });

    it('a duplicate delivery is still a 200 <Response/>', async () => {
      ingest.mockResolvedValue({ outcome: 'duplicate', conversationId: 'c1', conversationCreated: false, mediaQueued: 0 });
      const body = form();
      const res = await request(app.getHttpServer())
        .post(INBOUND_PATH)
        .set('X-Twilio-Signature', sign(INBOUND_PATH, body))
        .type('form')
        .send(body);
      expect(res.status).toBe(200);
      expect(res.text).toBe('<Response/>');
    });

    it('a malformed form is a 400 that is still TwiML, and nothing is stored', async () => {
      const body = { AccountSid: 'AC00000000000000000000000000000000', From: 'not-a-number', To: '+15550001111' };
      const res = await request(app.getHttpServer())
        .post(INBOUND_PATH)
        .set('X-Twilio-Signature', sign(INBOUND_PATH, body))
        .type('form')
        .send(body);
      expect(res.status).toBe(400);
      expect(res.headers['content-type']).toMatch(/^text\/xml/);
      expect(res.text).toBe('<Response/>');
      expect(ingest).not.toHaveBeenCalled();
    });

    it('a storage failure surfaces as a 5xx so Twilio moves on to the fallback URL', async () => {
      ingest.mockRejectedValue(new Error('DynamoDB unavailable'));
      const body = form();
      const res = await request(app.getHttpServer())
        .post(INBOUND_PATH)
        .set('X-Twilio-Signature', sign(INBOUND_PATH, body))
        .type('form')
        .send(body);
      expect(res.status).toBe(500);
    });
  });

  describe('POST /webhooks/twilio/fallback', () => {
    it('is signature-guarded too', async () => {
      const res = await request(app.getHttpServer()).post(FALLBACK_PATH).type('form').send(form());
      expect(res.status).toBe(403);
      expect(capture).not.toHaveBeenCalled();
    });

    it('captures the raw form and answers 200 <Response/>', async () => {
      const body = form({ ErrorCode: '11200', ErrorUrl: 'https://api.example.test/api/messaging/webhooks/twilio/inbound' });
      const res = await request(app.getHttpServer())
        .post(FALLBACK_PATH)
        .set('X-Twilio-Signature', sign(FALLBACK_PATH, body))
        .type('form')
        .send(body);
      expect(res.status).toBe(200);
      expect(res.text).toBe('<Response/>');
      expect(capture).toHaveBeenCalledWith(body);
    });

    it('answers 500 when neither S3 nor the queue took the payload', async () => {
      capture.mockResolvedValue({ queued: false });
      const body = form();
      const res = await request(app.getHttpServer())
        .post(FALLBACK_PATH)
        .set('X-Twilio-Signature', sign(FALLBACK_PATH, body))
        .type('form')
        .send(body);
      expect(res.status).toBe(500);
      expect(res.text).toBe('<Response/>');
    });
  });
});
