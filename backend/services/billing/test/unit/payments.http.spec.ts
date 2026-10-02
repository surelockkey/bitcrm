/* eslint-disable @typescript-eslint/no-explicit-any */
import { Test } from '@nestjs/testing';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import request from 'supertest';
import { HttpExceptionFilter } from '@bitcrm/shared';
import { PaymentsController } from 'src/payments/payments.controller';
import { PaymentsService } from 'src/payments/payments.service';
import { perms, user } from './mocks';

/**
 * The ledger's staff routes as the real app parses them: the global prefix,
 * the ValidationPipe main.ts installs (transform + whitelist) and the shared
 * exception filter. The service is a stand-in — what is checked here is what
 * reaches it, and what never does.
 */
describe('Payments ledger routes (HTTP)', () => {
  let app: INestApplication;
  const payments = {
    sendReceipt: jest.fn(async (..._a: any[]): Promise<any> => ({ sent: true, sentTo: 'walter@example.com' })),
  };

  beforeAll(async () => {
    const mod = await Test.createTestingModule({
      controllers: [PaymentsController],
      providers: [
        {
          provide: APP_GUARD,
          useValue: {
            canActivate: (ctx: any) => {
              const req = ctx.switchToHttp().getRequest();
              req.user = user({ id: 'tech-1' });
              req.resolvedPermissions = perms();
              return true;
            },
          },
        },
        { provide: PaymentsService, useValue: payments },
      ],
    }).compile();
    app = mod.createNestApplication();
    app.setGlobalPrefix('api/billing');
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => jest.clearAllMocks());

  const http = () => request(app.getHttpServer());

  describe('POST /payments/:paymentId/receipt', () => {
    it('hands the address typed on the phone to the service, with the caller’s own bearer', async () => {
      const res = await http()
        .post('/api/billing/payments/p1/receipt')
        .set('authorization', 'Bearer abc')
        .send({ channel: 'email', to: 'walter@example.com', sneaky: 'dropped' });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: true, data: { sent: true, sentTo: 'walter@example.com' } });
      const [paymentId, caller, authorization, body] = payments.sendReceipt.mock.calls[0];
      expect(paymentId).toBe('p1');
      expect(caller.user.id).toBe('tech-1');
      expect(authorization).toBe('Bearer abc');
      expect({ ...body }).toEqual({ channel: 'email', to: 'walter@example.com' });
    });

    it('takes a number to text in E.164', async () => {
      const res = await http().post('/api/billing/payments/p1/receipt').send({ channel: 'sms', to: '+18605550100' });
      expect(res.status).toBe(200);
      expect({ ...payments.sendReceipt.mock.calls[0][3] }).toEqual({ channel: 'sms', to: '+18605550100' });
    });

    it('still takes no body at all — today’s receipt (the client’s number, else their email)', async () => {
      const res = await http().post('/api/billing/payments/p1/receipt');
      expect(res.status).toBe(200);
      const body = payments.sendReceipt.mock.calls[0][3];
      expect(body?.channel).toBeUndefined();
      expect(body?.to).toBeUndefined();
    });

    it('400s an address that is not one — the service never hears of it', async () => {
      for (const body of [
        { channel: 'email', to: 'walter@' },
        { channel: 'email', to: '' },
        { channel: 'email', to: 42 },
        { channel: 'sms', to: '860-555-0100' },
        { channel: 'sms', to: 'walter@example.com' },
        { channel: 'fax' },
        { to: 'walter@example.com' },
      ]) {
        const res = await http().post('/api/billing/payments/p1/receipt').send(body);
        expect(res.status).toBe(400);
      }
      expect(payments.sendReceipt).not.toHaveBeenCalled();
    });
  });
});
