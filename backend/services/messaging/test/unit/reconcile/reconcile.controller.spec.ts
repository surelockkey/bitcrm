import { ExecutionContext, ForbiddenException, NotFoundException } from '@nestjs/common';
import { GUARDS_METADATA, HTTP_CODE_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { IS_PUBLIC_KEY } from '@bitcrm/shared';
import { ReconcileController } from '../../../src/reconcile/reconcile.controller';
import { ReconcileDto } from '../../../src/reconcile/dto/reconcile.dto';
import { SyncMessageDto } from '../../../src/reconcile/dto/sync-message.dto';
import { InternalGuard } from '../../../src/common/guards/internal.guard';
import { type ReconcileService } from '../../../src/reconcile/reconcile.service';
import { createMockMessage, T1 } from '../mocks';

describe('ReconcileController', () => {
  it('is an internal route: public to Cognito, gated by the internal secret', () => {
    const handler = ReconcileController.prototype.run;
    expect(Reflect.getMetadata(PATH_METADATA, ReconcileController)).toBe('internal');
    expect(Reflect.getMetadata(PATH_METADATA, handler)).toBe('reconcile');
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, handler)).toBe(true);
    expect(Reflect.getMetadata(GUARDS_METADATA, handler)).toEqual([InternalGuard]);
  });

  it('POST internal/reconcile/message is internal too, answers 200 with the outcome and 404 for an unknown message', async () => {
    const handler = ReconcileController.prototype.syncMessage;
    expect(Reflect.getMetadata(PATH_METADATA, handler)).toBe('reconcile/message');
    expect(Reflect.getMetadata(HTTP_CODE_METADATA, handler)).toBe(200);
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, handler)).toBe(true);
    expect(Reflect.getMetadata(GUARDS_METADATA, handler)).toEqual([InternalGuard]);

    const message = createMockMessage({ id: 'm2', direction: 'outbound', status: 'delivered' });
    const syncMessage = jest.fn().mockResolvedValue({ outcome: 'synced', message, providerStatus: 'delivered' });
    const controller = new ReconcileController({ syncMessage } as unknown as ReconcileService);
    const dto = Object.assign(new SyncMessageDto(), { conversationId: 'c1', createdAt: T1, messageId: 'm2' });
    expect(await controller.syncMessage(dto)).toEqual({ success: true, data: { outcome: 'synced', message, providerStatus: 'delivered' } });
    expect(syncMessage).toHaveBeenCalledWith({ conversationId: 'c1', createdAt: T1, messageId: 'm2' });

    syncMessage.mockResolvedValueOnce({ outcome: 'not_found' });
    await expect(controller.syncMessage(dto)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('validates the message key: three non-empty strings, createdAt a strict ISO timestamp', async () => {
    expect(await validate(plainToInstance(SyncMessageDto, { conversationId: 'c1', createdAt: T1, messageId: 'm2' }))).toHaveLength(0);
    const bad = await validate(plainToInstance(SyncMessageDto, { conversationId: '', createdAt: 'yesterday' }));
    expect(bad.map((e) => e.property).sort()).toEqual(['conversationId', 'createdAt', 'messageId']);
  });

  it('wraps the report in the envelope', async () => {
    const run = jest.fn().mockResolvedValue({ scanned: 3, skipped: 3 });
    const controller = new ReconcileController({ run } as unknown as ReconcileService);
    const dto = Object.assign(new ReconcileDto(), { since: '2026-09-15T09:00:00.000Z' });
    expect(await controller.run(dto)).toEqual({ success: true, data: { scanned: 3, skipped: 3 } });
    expect(run).toHaveBeenCalledWith(dto);
  });

  it('validates the window: ISO timestamps and a bounded integer limit', async () => {
    expect(await validate(plainToInstance(ReconcileDto, {}))).toHaveLength(0);
    expect(await validate(plainToInstance(ReconcileDto, { since: '2026-09-15T09:00:00.000Z', until: '2026-09-15T10:00:00Z', limit: '20' }))).toHaveLength(0);
    const bad = await validate(plainToInstance(ReconcileDto, { since: 'yesterday', limit: 0 }));
    expect(bad.map((e) => e.property).sort()).toEqual(['limit', 'since']);
  });
});

describe('InternalGuard', () => {
  const contextWith = (headers: Record<string, string>): ExecutionContext =>
    ({ switchToHttp: () => ({ getRequest: () => ({ headers }) }) }) as unknown as ExecutionContext;

  afterEach(() => {
    delete process.env.INTERNAL_SERVICE_SECRET;
  });

  it('admits the configured secret and refuses anything else, including an unset secret', () => {
    process.env.INTERNAL_SERVICE_SECRET = 's3cret';
    const guard = new InternalGuard();
    expect(guard.canActivate(contextWith({ 'x-internal-secret': 's3cret' }))).toBe(true);
    expect(() => guard.canActivate(contextWith({ 'x-internal-secret': 'nope' }))).toThrow(ForbiddenException);
    expect(() => guard.canActivate(contextWith({}))).toThrow(ForbiddenException);

    delete process.env.INTERNAL_SERVICE_SECRET;
    expect(() => guard.canActivate(contextWith({ 'x-internal-secret': '' }))).toThrow(ForbiddenException);
  });
});
