import { ForbiddenException } from '@nestjs/common';
import { type JwtUser, type TechnicianLocation } from '@bitcrm/types';
import { TechnicianLocationController } from '../../../src/technicians/location/technician-location.controller';

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

/** The response object Nest hands a passthrough `@Res()`: only the status is set by hand. */
function fakeRes() {
  return { status: jest.fn() };
}

describe('TechnicianLocationController (unit)', () => {
  let service: { setLocation: jest.Mock; clearLocation: jest.Mock; listLocations: jest.Mock };
  let controller: TechnicianLocationController;

  beforeEach(() => {
    service = {
      setLocation: jest.fn(),
      clearLocation: jest.fn().mockResolvedValue(undefined),
      listLocations: jest.fn().mockResolvedValue([fix]),
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
});
