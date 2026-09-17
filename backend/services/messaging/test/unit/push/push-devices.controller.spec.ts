import 'reflect-metadata';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { PERMISSION_KEY } from '@bitcrm/shared';
import { RegisterDeviceDto } from '../../../src/push/dto/register-device.dto';
import { PushDevicesController } from '../../../src/push/push-devices.controller';
import { TECH } from '../api/api-mocks';

const TOKEN = 'ExponentPushToken[abc123]';

function makeController(removed = true) {
  const devices = {
    register: jest.fn(async (input: Record<string, unknown>) => ({
      ...input,
      registeredAt: '2026-09-17T09:00:00.000Z',
      lastSeenAt: '2026-09-17T09:00:00.000Z',
    })),
    removeForUser: jest.fn(async () => removed),
  };
  return { controller: new PushDevicesController(devices as any), devices };
}

describe('PushDevicesController', () => {
  it('registers the token for the caller and answers the contract shape', async () => {
    const { controller, devices } = makeController();

    const answer = await controller.register(
      { token: TOKEN, platform: 'ios', appVersion: '1.4.0', deviceName: "Ann's iPhone" },
      TECH,
    );

    expect(devices.register).toHaveBeenCalledWith({
      token: TOKEN,
      userId: TECH.id,
      platform: 'ios',
      appVersion: '1.4.0',
      deviceName: "Ann's iPhone",
    });
    expect(answer).toEqual({
      success: true,
      data: { token: TOKEN, registeredAt: '2026-09-17T09:00:00.000Z' },
    });
  });

  it('takes the user from the JWT, never from the body', async () => {
    const { controller, devices } = makeController();

    // A body that tries to claim another user id is simply not read: the DTO
    // has no such field, and the caller comes from the token.
    await controller.register({ token: TOKEN, platform: 'android', userId: 'someone-else' } as never, TECH);

    expect(devices.register).toHaveBeenCalledWith(expect.objectContaining({ userId: TECH.id }));
  });

  it('unregisters idempotently — a token that was never the caller answers the same', async () => {
    const mine = makeController(true);
    expect(await mine.controller.unregister(TOKEN, TECH)).toEqual({ success: true, data: { token: TOKEN } });
    expect(mine.devices.removeForUser).toHaveBeenCalledWith(TOKEN, TECH.id);

    const theirs = makeController(false);
    expect(await theirs.controller.unregister(TOKEN, TECH)).toEqual({ success: true, data: { token: TOKEN } });
  });

  it('is guarded by a valid token alone — a technician has no permission to spend here', () => {
    // Deliberate: the global CognitoAuthGuard still demands a bearer token,
    // and PermissionGuard lets an undecorated route through. Gating device
    // registration behind a permission would lock out exactly the field
    // users the app exists for.
    const perm = (method: keyof PushDevicesController) =>
      Reflect.getMetadata(PERMISSION_KEY, PushDevicesController.prototype[method]);
    expect(perm('register')).toBeUndefined();
    expect(perm('unregister')).toBeUndefined();
    expect(Reflect.getMetadata(PERMISSION_KEY, PushDevicesController)).toBeUndefined();
  });

  describe('RegisterDeviceDto', () => {
    const errorsFor = (body: Record<string, unknown>) =>
      validate(plainToInstance(RegisterDeviceDto, body)).then((e) => e.map((x) => x.property));

    it('accepts what the app sends', async () => {
      expect(await errorsFor({ token: TOKEN, platform: 'ios', appVersion: '1.4.0' })).toEqual([]);
      expect(await errorsFor({ token: TOKEN, platform: 'android' })).toEqual([]);
    });

    it('refuses a missing token and a platform we cannot push to', async () => {
      expect(await errorsFor({ platform: 'ios' })).toContain('token');
      expect(await errorsFor({ token: TOKEN, platform: 'web' })).toContain('platform');
      expect(await errorsFor({ token: '', platform: 'ios' })).toContain('token');
    });
  });
});
