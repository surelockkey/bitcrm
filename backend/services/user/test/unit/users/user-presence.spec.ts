import { MODULE_METADATA, PATH_METADATA, METHOD_METADATA } from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common';
import { PERMISSION_KEY } from '@bitcrm/shared';
import { UsersModule } from '../../../src/users/users.module';
import { UsersController } from '../../../src/users/users.controller';
import { UserPresenceController } from '../../../src/users/user-presence.controller';

/**
 * Admin → Users "Online" / "Last seen": who is using the platform now. Every
 * signed-in request stamps its user (shared `UserActivityTracker`, touched by
 * the auth guard); these routes read it, and give the web's open tab a
 * request to make once a minute.
 */
const NOW = Date.parse('2026-10-12T15:00:00Z');

describe('UserPresenceController', () => {
  const lastSeen = jest.fn();
  const controller = new UserPresenceController({ lastSeen } as never);

  beforeEach(() => {
    lastSeen.mockReset();
    jest.useFakeTimers({ now: NOW });
  });
  afterEach(() => jest.useRealTimers());

  it('GET /users/presence: every user’s last-seen time, online within five minutes', async () => {
    lastSeen.mockResolvedValue(
      new Map([
        ['u-now', NOW - 30_000],
        ['u-edge', NOW - 300_000],
        ['u-gone', NOW - 301_000],
      ]),
    );

    await expect(controller.presence()).resolves.toEqual({
      success: true,
      data: [
        { userId: 'u-now', lastSeenAt: '2026-10-12T14:59:30.000Z', online: true },
        { userId: 'u-edge', lastSeenAt: '2026-10-12T14:55:00.000Z', online: true },
        { userId: 'u-gone', lastSeenAt: '2026-10-12T14:54:59.000Z', online: false },
      ],
    });
  });

  it('is gated by users.view, under the users prefix', () => {
    expect(Reflect.getMetadata(PERMISSION_KEY, UserPresenceController.prototype.presence)).toEqual({
      resource: 'users',
      action: 'view',
    });
    expect(Reflect.getMetadata(PATH_METADATA, UserPresenceController.prototype.presence)).toBe('presence');
  });

  it('POST /users/me/heartbeat: any signed-in user — the guard stamped them on the way in', async () => {
    await expect(controller.heartbeat()).resolves.toEqual({ success: true, data: { ok: true } });
    expect(Reflect.getMetadata(PERMISSION_KEY, UserPresenceController.prototype.heartbeat)).toBeUndefined();
    expect(Reflect.getMetadata(PATH_METADATA, UserPresenceController.prototype.heartbeat)).toBe('me/heartbeat');
    expect(Reflect.getMetadata(METHOD_METADATA, UserPresenceController.prototype.heartbeat)).toBe(RequestMethod.POST);
  });

  it('is registered ahead of UsersController, whose GET /:id would take "presence"', () => {
    const controllers: unknown[] = Reflect.getMetadata(MODULE_METADATA.CONTROLLERS, UsersModule);
    expect(controllers.indexOf(UserPresenceController)).toBeGreaterThanOrEqual(0);
    expect(controllers.indexOf(UserPresenceController)).toBeLessThan(controllers.indexOf(UsersController));
  });
});
