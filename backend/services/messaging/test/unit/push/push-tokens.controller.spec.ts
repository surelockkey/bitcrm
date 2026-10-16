import 'reflect-metadata';
import { RequestMethod } from '@nestjs/common';
import { HTTP_CODE_METADATA, METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { PERMISSION_KEY } from '@bitcrm/shared';
import { RegisterPushTokenDto } from '../../../src/push/dto/register-push-token.dto';
import { PushTokensController } from '../../../src/push/push-tokens.controller';
import { PushTokensService } from '../../../src/push/push-tokens.service';
import { TECH } from '../api/api-mocks';

const TOKEN = 'ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]';

describe('PushTokensController', () => {
  it('PUT /push-tokens stores the token for the caller and answers 204 — any signed-in user, no permission', async () => {
    const service = { register: jest.fn(async () => undefined), unregister: jest.fn(async () => undefined) };
    const controller = new PushTokensController(service as any);

    expect(await controller.register({ token: TOKEN, platform: 'ios' }, TECH)).toBeUndefined();
    expect(service.register).toHaveBeenCalledWith('tech-1', { token: TOKEN, platform: 'ios' });

    const handler = PushTokensController.prototype.register;
    expect(Reflect.getMetadata(METHOD_METADATA, handler)).toBe(RequestMethod.PUT);
    expect(Reflect.getMetadata(HTTP_CODE_METADATA, handler)).toBe(204);
    expect(Reflect.getMetadata(PERMISSION_KEY, handler)).toBeUndefined();
    expect(Reflect.getMetadata(PATH_METADATA, PushTokensController)).toBe('push-tokens');
  });

  it("DELETE /push-tokens/:token removes the caller's own token and answers 204", async () => {
    const service = { register: jest.fn(), unregister: jest.fn(async () => undefined) };
    const controller = new PushTokensController(service as any);

    expect(await controller.unregister(TOKEN, TECH)).toBeUndefined();
    expect(service.unregister).toHaveBeenCalledWith('tech-1', TOKEN);

    const handler = PushTokensController.prototype.unregister;
    expect(Reflect.getMetadata(METHOD_METADATA, handler)).toBe(RequestMethod.DELETE);
    expect(Reflect.getMetadata(PATH_METADATA, handler)).toBe(':token');
    expect(Reflect.getMetadata(HTTP_CODE_METADATA, handler)).toBe(204);
    expect(Reflect.getMetadata(PERMISSION_KEY, handler)).toBeUndefined();
  });
});

describe('RegisterPushTokenDto', () => {
  const errors = (body: unknown) => validate(plainToInstance(RegisterPushTokenDto, body));

  it('accepts both Expo token spellings on ios and android', async () => {
    expect(await errors({ token: TOKEN, platform: 'ios' })).toHaveLength(0);
    expect(await errors({ token: 'ExpoPushToken[abc-DEF_123]', platform: 'android' })).toHaveLength(0);
  });

  it('refuses anything that is not an Expo push token, and unknown platforms', async () => {
    for (const token of ['', 'abc', 'ExponentPushToken[]', 'ExponentPushToken[a b]', 'FCM:abc', `ExponentPushToken[${'x'.repeat(300)}]`, 42]) {
      expect(await errors({ token, platform: 'ios' })).not.toHaveLength(0);
    }
    expect(await errors({ token: TOKEN, platform: 'web' })).not.toHaveLength(0);
    expect(await errors({ token: TOKEN })).not.toHaveLength(0);
  });
});

describe('PushTokensService', () => {
  it('hands the caller and the token to the repository', async () => {
    const repo = { register: jest.fn(async () => undefined), unregister: jest.fn(async () => undefined) };
    const service = new PushTokensService(repo as any);

    await service.register('u1', { token: TOKEN, platform: 'android' });
    expect(repo.register).toHaveBeenCalledWith('u1', TOKEN, 'android');
    await service.unregister('u1', TOKEN);
    expect(repo.unregister).toHaveBeenCalledWith('u1', TOKEN);
  });
});
