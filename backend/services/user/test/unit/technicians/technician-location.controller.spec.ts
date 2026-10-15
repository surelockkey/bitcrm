import 'reflect-metadata';
import { ForbiddenException, HttpStatus, RequestMethod } from '@nestjs/common';
import {
  HTTP_CODE_METADATA,
  METHOD_METADATA,
  MODULE_METADATA,
  PATH_METADATA,
} from '@nestjs/common/constants';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { PERMISSION_KEY } from '@bitcrm/shared';
import { type JwtUser, type TechnicianLocation } from '@bitcrm/types';
import { TechnicianLocationController } from '../../../src/technicians/location/technician-location.controller';
import { SetLocationStateDto } from '../../../src/technicians/location/dto/set-location-state.dto';
import { TechniciansModule } from '../../../src/technicians/technicians.module';
import { UsersController } from '../../../src/users/users.controller';
import { type TechnicianLocationState } from '../../../src/technicians/location/technician-location.service';

const tech: JwtUser = {
  id: 'tech-1',
  cognitoSub: 'sub',
  email: 'tech@test.com',
  roleId: 'role-technician',
  department: 'HVAC',
};
const dispatcher: JwtUser = { ...tech, id: 'disp-1', email: 'disp@test.com', roleId: 'role-dispatcher' };

const fix: TechnicianLocation = {
  userId: 'tech-1',
  lat: 33.749,
  lng: -84.388,
  accuracy: 10,
  updatedAt: '2026-10-14T12:00:00.000Z',
};

const offState: TechnicianLocationState = {
  userId: 'tech-1',
  permission: 'denied',
  updatedAt: '2026-10-15T13:35:00.000Z',
};

const proto = TechnicianLocationController.prototype;

/**
 * Every route of a controller as `METHOD path` (its prefix joined in), to
 * prove which routes a request could land on whatever the registration order.
 */
function routesOf(controller: { prototype: object }): { method: RequestMethod; path: string; handler: string }[] {
  const prefix = String(Reflect.getMetadata(PATH_METADATA, controller) ?? '');
  const p = controller.prototype as Record<string, unknown>;
  return Object.getOwnPropertyNames(p).flatMap((handler) => {
    const fn = p[handler];
    const path = typeof fn === 'function' ? Reflect.getMetadata(PATH_METADATA, fn) : undefined;
    if (path === undefined) return [];
    const method = Reflect.getMetadata(METHOD_METADATA, fn as object) as RequestMethod;
    return [{ method, path: [prefix, String(path)].filter((x) => x && x !== '/').join('/'), handler }];
  });
}

/** Whether a route pattern (`technicians/:id/location`) takes a concrete path. */
function takes(pattern: string, path: string): boolean {
  const a = pattern.split('/').filter(Boolean);
  const b = path.split('/').filter(Boolean);
  return a.length === b.length && a.every((seg, i) => seg.startsWith(':') || seg === b[i]);
}

/** The response object Nest hands a passthrough `@Res()`: only the status is set by hand. */
function fakeRes() {
  return { status: jest.fn() };
}

describe('TechnicianLocationController (unit)', () => {
  let service: {
    setLocation: jest.Mock;
    clearLocation: jest.Mock;
    listLocations: jest.Mock;
    setLocationState: jest.Mock;
    listLocationStates: jest.Mock;
  };
  let controller: TechnicianLocationController;

  beforeEach(() => {
    service = {
      setLocation: jest.fn(),
      clearLocation: jest.fn().mockResolvedValue(undefined),
      listLocations: jest.fn().mockResolvedValue([fix]),
      setLocationState: jest.fn().mockResolvedValue(null),
      listLocationStates: jest.fn().mockResolvedValue([offState]),
    };
    controller = new TechnicianLocationController(service as never);
  });

  describe('POST :id/location', () => {
    it('stores the technician’s own fix and answers it', async () => {
      service.setLocation.mockResolvedValue(fix);
      const res = fakeRes();

      const out = await controller.setLocation('tech-1', { lat: 33.749, lng: -84.388, accuracy: 10 }, tech, res as never);

      expect(service.setLocation).toHaveBeenCalledWith('tech-1', { lat: 33.749, lng: -84.388, accuracy: 10 });
      expect(out).toEqual({ success: true, data: fix });
      expect(res.status).not.toHaveBeenCalled();
    });

    // Tracking off on the card, or a subcontractor: the phone is told nothing
    // went wrong (an old build keeps posting) and nothing is stored.
    it('answers 204 with no body when the fix was accepted and dropped', async () => {
      service.setLocation.mockResolvedValue(null);
      const res = fakeRes();

      const out = await controller.setLocation('tech-1', { lat: 1, lng: 2 }, tech, res as never);

      expect(res.status).toHaveBeenCalledWith(204);
      expect(out).toBeUndefined();
    });

    it('forbids posting another technician’s location before touching the store', async () => {
      await expect(
        controller.setLocation('tech-2', { lat: 1, lng: 2 }, tech, fakeRes() as never),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(service.setLocation).not.toHaveBeenCalled();
    });
  });

  describe('DELETE :id/location', () => {
    it('lets a technician clear their own fix', async () => {
      const out = await controller.clearLocation('tech-1', tech);
      expect(service.clearLocation).toHaveBeenCalledWith('tech-1');
      expect(out).toEqual({ success: true });
    });

    it('forbids clearing another technician’s fix', async () => {
      await expect(controller.clearLocation('tech-2', tech)).rejects.toBeInstanceOf(ForbiddenException);
      expect(service.clearLocation).not.toHaveBeenCalled();
    });
  });

  describe('GET locations', () => {
    it('hands dispatch the list', async () => {
      const out = await controller.listLocations(dispatcher);
      expect(out).toEqual({ success: true, data: [fix] });
    });

    it('hides the list from a field technician', async () => {
      await expect(controller.listLocations(tech)).rejects.toBeInstanceOf(ForbiddenException);
      expect(service.listLocations).not.toHaveBeenCalled();
    });
  });

  /**
   * The phone says whether it lets the app read its location (owner,
   * 2026-10-15): the dispatch map flags "Location off on the phone".
   */
  describe('PUT :id/location/state', () => {
    it('is guarded exactly like posting a fix: technicians.edit', () => {
      expect(Reflect.getMetadata(PERMISSION_KEY, proto.setLocationState)).toEqual({ resource: 'technicians', action: 'edit' });
      expect(Reflect.getMetadata(PERMISSION_KEY, proto.setLocationState)).toEqual(
        Reflect.getMetadata(PERMISSION_KEY, proto.setLocation),
      );
      expect(Reflect.getMetadata(PATH_METADATA, proto.setLocationState)).toBe(':id/location/state');
      expect(Reflect.getMetadata(METHOD_METADATA, proto.setLocationState)).toBe(RequestMethod.PUT);
    });

    it('answers 204 with no body, stored or dropped alike', async () => {
      expect(Reflect.getMetadata(HTTP_CODE_METADATA, proto.setLocationState)).toBe(HttpStatus.NO_CONTENT);

      const out = await controller.setLocationState('tech-1', { permission: 'denied' }, tech);

      expect(service.setLocationState).toHaveBeenCalledWith('tech-1', { permission: 'denied' });
      expect(out).toBeUndefined();
    });

    it('forbids reporting another technician’s phone before touching the store', async () => {
      await expect(controller.setLocationState('tech-2', { permission: 'denied' }, tech)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(service.setLocationState).not.toHaveBeenCalled();
    });

    describe('the body', () => {
      const check = (body: object) => validate(plainToInstance(SetLocationStateDto, body));

      it('takes granted / denied / undetermined, with precise and background optional', async () => {
        expect(await check({ permission: 'granted', precise: true, background: false })).toEqual([]);
        expect(await check({ permission: 'denied' })).toEqual([]);
        expect(await check({ permission: 'undetermined' })).toEqual([]);
      });

      it('refuses any other permission, a missing one, and flags that are not booleans', async () => {
        expect(await check({ permission: 'off' })).not.toEqual([]);
        expect(await check({})).not.toEqual([]);
        expect(await check({ permission: 'granted', precise: 'no' })).not.toEqual([]);
        expect(await check({ permission: 'granted', background: 1 })).not.toEqual([]);
      });
    });
  });

  describe('GET location-states', () => {
    it('is guarded exactly like the locations: technicians.view', () => {
      expect(Reflect.getMetadata(PERMISSION_KEY, proto.listLocationStates)).toEqual({ resource: 'technicians', action: 'view' });
      expect(Reflect.getMetadata(PERMISSION_KEY, proto.listLocationStates)).toEqual(
        Reflect.getMetadata(PERMISSION_KEY, proto.listLocations),
      );
      expect(Reflect.getMetadata(PATH_METADATA, proto.listLocationStates)).toBe('location-states');
      expect(Reflect.getMetadata(METHOD_METADATA, proto.listLocationStates)).toBe(RequestMethod.GET);
    });

    it('hands dispatch every phone’s state', async () => {
      expect(await controller.listLocationStates(dispatcher)).toEqual({ success: true, data: [offState] });
    });

    it('hides it from a field technician', async () => {
      await expect(controller.listLocationStates(tech)).rejects.toBeInstanceOf(ForbiddenException);
      expect(service.listLocationStates).not.toHaveBeenCalled();
    });
  });

  // Under the shared `technicians` prefix (and the users' own `:id` routes) a
  // literal path is shadowed by an earlier `:id` pattern that also takes it.
  // Exactly one route taking each path means no order can swallow them.
  describe('route order', () => {
    const controllers = [
      ...(Reflect.getMetadata(MODULE_METADATA.CONTROLLERS, TechniciansModule) as { prototype: object }[]),
      UsersController,
    ];
    const routes = controllers.flatMap((c) => routesOf(c).map((r) => ({ ...r, controller: c })));
    const takers = (method: RequestMethod, path: string) =>
      routes.filter((r) => r.method === method && takes(r.path, path)).map((r) => r.handler);

    it('GET /technicians/location-states lands on the states, nothing else takes it', () => {
      expect(takers(RequestMethod.GET, 'technicians/location-states')).toEqual(['listLocationStates']);
    });

    it('PUT /technicians/:id/location/state lands on the state, nothing else takes it', () => {
      expect(takers(RequestMethod.PUT, 'technicians/tech-1/location/state')).toEqual(['setLocationState']);
    });
  });
});
