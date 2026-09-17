import { ForbiddenException } from '@nestjs/common';
import { type JwtUser } from '@bitcrm/types';
import { TechnicianLocationController } from '../../../../src/technicians/location/technician-location.controller';

const tech: JwtUser = {
  id: 'tech-1', cognitoSub: 's', email: 't@x.com', roleId: 'role-technician', department: 'Field',
};
const dispatcher: JwtUser = {
  id: 'disp-1', cognitoSub: 's', email: 'd@x.com', roleId: 'role-dispatcher', department: 'HQ',
};

const RANGE = { from: '2026-09-17', to: '2026-09-17' };

describe('TechnicianLocationController — history', () => {
  let service: { listHistory: jest.Mock };
  let controller: TechnicianLocationController;

  beforeEach(() => {
    service = { listHistory: jest.fn().mockResolvedValue([]) };
    controller = new TechnicianLocationController(service as never);
  });

  it('lets a technician read his own trail', async () => {
    const result = await controller.listHistory('tech-1', RANGE, tech);

    expect(service.listHistory).toHaveBeenCalledWith('tech-1', '2026-09-17', '2026-09-17');
    expect(result).toEqual({ success: true, data: [] });
  });

  // The same rule the live map already applies: a technician sees the map from
  // his own app, not everyone else's position — and not yesterday's either.
  it('refuses one technician reading another’s trail', async () => {
    await expect(controller.listHistory('tech-2', RANGE, tech)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(service.listHistory).not.toHaveBeenCalled();
  });

  it('lets a dispatcher read a technician’s trail', async () => {
    await controller.listHistory('tech-1', RANGE, dispatcher);
    expect(service.listHistory).toHaveBeenCalledWith('tech-1', '2026-09-17', '2026-09-17');
  });
});
