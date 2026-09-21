import 'reflect-metadata';
import { HTTP_CODE_METADATA, METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common';
import { PERMISSION_KEY } from '@bitcrm/shared';
import { SendController } from '../../../src/outbound/send.controller';
import { type SendService } from '../../../src/outbound/send.service';
import { ADMIN, adminPerms } from '../api/api-mocks';
import { createMockMessage, T0 } from '../mocks';

describe('SendController', () => {
  it('declares the three POST routes under messages.send, all answering 202', () => {
    expect(Reflect.getMetadata(PATH_METADATA, SendController)).toBe('/');
    const routes: Array<[keyof SendController, string]> = [
      ['send', 'conversations/:id/messages'],
      ['resend', 'conversations/:id/messages/:messageId/resend'],
      ['sendToParty', 'messages'],
    ];
    for (const [method, path] of routes) {
      const handler = SendController.prototype[method];
      expect(Reflect.getMetadata(PATH_METADATA, handler)).toBe(path);
      expect(Reflect.getMetadata(METHOD_METADATA, handler)).toBe(RequestMethod.POST);
      expect(Reflect.getMetadata(HTTP_CODE_METADATA, handler)).toBe(202);
      expect(Reflect.getMetadata(PERMISSION_KEY, handler)).toEqual({ resource: 'messages', action: 'send' });
    }
  });

  it('declares send-options as the one GET, under the same messages.send grant as the sends it describes', () => {
    const handler = SendController.prototype.sendOptions;
    expect(Reflect.getMetadata(PATH_METADATA, handler)).toBe('conversations/:id/send-options');
    expect(Reflect.getMetadata(METHOD_METADATA, handler)).toBe(RequestMethod.GET);
    expect(Reflect.getMetadata(PERMISSION_KEY, handler)).toEqual({ resource: 'messages', action: 'send' });
    // A read answers 200, not the 202 the sends use.
    expect(Reflect.getMetadata(HTTP_CODE_METADATA, handler)).toBeUndefined();
  });

  it('GET /conversations/:id/send-options — hands the id and the caller to the service, wraps the answer', async () => {
    const options = { conversationId: 'c1', defaultChannel: 'sms' as const, channels: [] };
    const sendOptions = jest.fn().mockResolvedValue(options);
    const controller = new SendController({ sendOptions } as unknown as SendService);
    const perms = adminPerms();

    expect(await controller.sendOptions('c1', ADMIN, perms)).toEqual({ success: true, data: options });
    expect(sendOptions).toHaveBeenCalledWith('c1', { user: ADMIN, perms });
  });

  it('POST /conversations/:id/messages/:messageId/resend — hands the ids, the body and the caller to the service, wraps the copy', async () => {
    const copy = createMockMessage({ id: 'm-new', direction: 'outbound', status: 'queued', resentFromMessageId: 'm-fail' });
    const resend = jest.fn().mockResolvedValue(copy);
    const controller = new SendController({ resend } as unknown as SendService);
    const perms = adminPerms();

    expect(await controller.resend('c1', 'm-fail', { createdAt: T0 }, ADMIN, perms)).toEqual({ success: true, data: copy });
    expect(resend).toHaveBeenCalledWith('c1', 'm-fail', { createdAt: T0 }, { user: ADMIN, perms });

    // an empty body is fine — the route needs nothing but the URL
    await controller.resend('c1', 'm-fail', undefined as never, ADMIN, undefined);
    expect(resend).toHaveBeenLastCalledWith('c1', 'm-fail', {}, { user: ADMIN, perms: undefined });
  });
});
