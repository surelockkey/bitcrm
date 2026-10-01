/* eslint-disable @typescript-eslint/no-explicit-any */
import { Test } from '@nestjs/testing';
import { ConflictException, ValidationPipe, type INestApplication } from '@nestjs/common';
import { APP_GUARD, Reflector } from '@nestjs/core';
import request from 'supertest';
import { HttpExceptionFilter, PermissionGuard } from '@bitcrm/shared';
import { DataScope } from '@bitcrm/types';
import {
  EstimateTerminalController,
  InvoiceTerminalController,
  TerminalController,
  TerminalIntentsController,
} from 'src/payments/terminal/terminal.controller';
import { TerminalService } from 'src/payments/terminal/terminal.service';
import { perms, user } from './mocks';

const ATTEMPT = '0b9c6d2e-4f1a-4c3b-9d8e-7a6b5c4d3e2f';

/**
 * The Terminal routes as the real app serves them: the global prefix, the
 * ValidationPipe main.ts installs (transform + whitelist), the shared
 * exception filter, and the REAL PermissionGuard — fed by a permission cache
 * that knows two roles: a technician who may collect payments, and one who
 * may only look at them.
 */
describe('Stripe Terminal routes (HTTP)', () => {
  let app: INestApplication;
  const intent = {
    paymentId: ATTEMPT,
    intentId: 'pi_1',
    clientSecret: 'pi_1_secret_x',
    amount: 60,
    tipAmount: 9,
    total: 69,
    currency: 'usd',
    status: 'pending',
  };
  const outcome = { payment: { id: ATTEMPT, status: 'settled' }, ledger: { dealId: 'deal-1', balanceDue: 40 } };
  const terminal = {
    connectionToken: jest.fn(async () => ({ secret: 'pst_test_1' })),
    location: jest.fn(async () => ({ locationId: null })),
    ensureLocation: jest.fn(async () => ({ locationId: 'tml_1' })),
    openForInvoice: jest.fn(async (..._a: any[]): Promise<any> => intent),
    openForEstimate: jest.fn(async (..._a: any[]): Promise<any> => intent),
    cancel: jest.fn(async (..._a: any[]): Promise<any> => outcome),
    sync: jest.fn(async (..._a: any[]): Promise<any> => outcome),
  };

  const collector = { ...perms(DataScope.ASSIGNED_ONLY) };
  const viewer = {
    ...perms(DataScope.ASSIGNED_ONLY),
    permissions: { ...perms().permissions, payments: { view: true, collect: false, refund: false } },
  };

  beforeAll(async () => {
    const cache = {
      getPermissions: jest.fn(async (_userId: string, roleId: string) => (roleId === 'viewer' ? viewer : collector)),
    };
    const mod = await Test.createTestingModule({
      controllers: [TerminalController, InvoiceTerminalController, EstimateTerminalController, TerminalIntentsController],
      providers: [
        {
          provide: APP_GUARD,
          inject: [Reflector],
          useFactory: (reflector: Reflector) => {
            const permissions = new PermissionGuard(reflector, cache as any);
            return {
              // Cognito's part (stubbed): who is calling. The permission check is the real one.
              canActivate: (ctx: any) => {
                const req = ctx.switchToHttp().getRequest();
                req.user = user({ id: 'tech-1', roleId: req.headers['x-role'] ?? 'collector' });
                return permissions.canActivate(ctx);
              },
            };
          },
        },
        { provide: TerminalService, useValue: terminal },
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

  it('POST /terminal/connection-token answers { secret } to anyone who may collect payments', async () => {
    const res = await http().post('/api/billing/terminal/connection-token').send({});
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: { secret: 'pst_test_1' } });
  });

  it('GET and POST /terminal/location', async () => {
    expect((await http().get('/api/billing/terminal/location')).body.data).toEqual({ locationId: null });
    const res = await http().post('/api/billing/terminal/location').send({});
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ locationId: 'tml_1' });
    expect(terminal.ensureLocation).toHaveBeenCalledWith(expect.objectContaining({ user: expect.objectContaining({ id: 'tech-1' }) }));
  });

  it('POST /invoices/:id/terminal-intent hands the body and the caller to the service', async () => {
    const res = await http()
      .post('/api/billing/invoices/deal-1/terminal-intent')
      .send({ amount: 60, tipAmount: 9, attemptId: ATTEMPT, sneaky: 'dropped' });
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual(intent);
    const [id, body, caller] = terminal.openForInvoice.mock.calls[0];
    expect(id).toBe('deal-1');
    expect({ ...body }).toEqual({ amount: 60, tipAmount: 9, attemptId: ATTEMPT });
    expect(caller.user.id).toBe('tech-1');
    expect(caller.perms.dataScope.payments).toBe(DataScope.ASSIGNED_ONLY);
  });

  it('POST /estimates/:id/terminal-intent takes a deposit the same way', async () => {
    const res = await http().post('/api/billing/estimates/est-1/terminal-intent').send({ amount: 50, attemptId: ATTEMPT });
    expect(res.status).toBe(200);
    expect(terminal.openForEstimate).toHaveBeenCalledWith('est-1', expect.objectContaining({ amount: 50, attemptId: ATTEMPT }), expect.anything());
  });

  it('POST /terminal-intents/:paymentId/cancel and /sync answer the payment with its job ledger', async () => {
    for (const action of ['cancel', 'sync'] as const) {
      const res = await http().post(`/api/billing/terminal-intents/${ATTEMPT}/${action}`).send({});
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual(outcome);
      expect(terminal[action]).toHaveBeenCalledWith(ATTEMPT, expect.objectContaining({ user: expect.anything() }));
    }
  });

  it('403s every Terminal route for a role without payments.collect — the service is never reached', async () => {
    // Built one at a time: supertest binds the server when a request is created.
    const calls = [
      () => http().post('/api/billing/terminal/connection-token').set('x-role', 'viewer'),
      () => http().get('/api/billing/terminal/location').set('x-role', 'viewer'),
      () => http().post('/api/billing/terminal/location').set('x-role', 'viewer'),
      () => http().post('/api/billing/invoices/deal-1/terminal-intent').set('x-role', 'viewer').send({ amount: 10, attemptId: ATTEMPT }),
      () => http().post('/api/billing/estimates/est-1/terminal-intent').set('x-role', 'viewer').send({ amount: 10, attemptId: ATTEMPT }),
      () => http().post(`/api/billing/terminal-intents/${ATTEMPT}/cancel`).set('x-role', 'viewer'),
      () => http().post(`/api/billing/terminal-intents/${ATTEMPT}/sync`).set('x-role', 'viewer'),
    ];
    for (const call of calls) {
      const res = await call();
      expect(res.status).toBe(403);
    }
    for (const fn of Object.values(terminal)) expect(fn).not.toHaveBeenCalled();
  });

  it('400s a body the phone got wrong: no or non-UUID attemptId, a negative tip, sub-cent amounts', async () => {
    for (const body of [
      { amount: 10 },
      { amount: 10, attemptId: 'retry-1' },
      { amount: 10, tipAmount: -1, attemptId: ATTEMPT },
      { amount: 10.001, attemptId: ATTEMPT },
      { amount: 0, attemptId: ATTEMPT },
      { attemptId: ATTEMPT },
    ]) {
      const res = await http().post('/api/billing/invoices/deal-1/terminal-intent').send(body);
      expect(res.status).toBe(400);
    }
    expect(terminal.openForInvoice).not.toHaveBeenCalled();
  });

  it('passes the sign-first 409 through to the phone with its exact copy', async () => {
    terminal.openForInvoice.mockRejectedValueOnce(new ConflictException('A signature is required before payment'));
    const res = await http().post('/api/billing/invoices/deal-1/terminal-intent').send({ amount: 10, attemptId: ATTEMPT });
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ success: false, error: { code: 'CONFLICT', message: 'A signature is required before payment' } });
  });
});
