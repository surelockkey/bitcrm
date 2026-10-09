import { type JwtUser } from '@bitcrm/types';
import { TechnicianAssignmentsController } from '../../../src/technicians/assignments/technician-assignments.controller';

const caller: JwtUser = {
  id: 'mgr-1',
  cognitoSub: 'sub',
  email: 'm@test.com',
  roleId: 'role-manager',
  department: 'HQ',
};

describe('TechnicianAssignmentsController (unit)', () => {
  let service: { listApproved: jest.Mock };
  let controller: TechnicianAssignmentsController;

  beforeEach(() => {
    service = { listApproved: jest.fn() };
    controller = new TechnicianAssignmentsController(service as never);
  });

  it("listApproved hands the caller on and wraps every technician's approved entries", async () => {
    const data = {
      jobTypes: [{ userId: 'tech-1', jobTypeId: 'jt-1', status: 'approved' }],
      serviceAreas: [],
    };
    service.listApproved.mockResolvedValue(data);

    const result = await controller.listApproved(caller);

    expect(service.listApproved).toHaveBeenCalledWith(caller);
    expect(result).toEqual({ success: true, data });
  });
});
