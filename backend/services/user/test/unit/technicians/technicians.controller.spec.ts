import { type JwtUser } from '@bitcrm/types';
import { TechniciansController } from '../../../src/technicians/technicians.controller';
import { createMockTechnicianProfile } from '../mocks';

const caller: JwtUser = {
  id: 'admin-1',
  cognitoSub: 'sub',
  email: 'admin@test.com',
  roleId: 'role-admin',
  department: 'HVAC',
};

describe('TechniciansController (unit)', () => {
  let service: {
    list: jest.Mock;
    getProfile: jest.Mock;
    updateProfile: jest.Mock;
    getOnboardingStatus: jest.Mock;
  };
  let controller: TechniciansController;

  beforeEach(() => {
    service = {
      list: jest.fn(),
      getProfile: jest.fn(),
      updateProfile: jest.fn(),
      getOnboardingStatus: jest.fn(),
    };
    controller = new TechniciansController(service as never);
  });

  it('list passes through the service envelope', async () => {
    service.list.mockResolvedValue({ success: true, data: [], pagination: { count: 0 } });
    const result = await controller.list({ limit: 20 }, caller);
    expect(service.list).toHaveBeenCalledWith({ limit: 20 }, caller);
    expect(result.success).toBe(true);
  });

  it('getProfile wraps the result in { success, data }', async () => {
    const profile = createMockTechnicianProfile();
    service.getProfile.mockResolvedValue(profile);
    const result = await controller.getProfile('tech-1', caller);
    expect(result).toEqual({ success: true, data: profile });
  });

  it('updateProfile delegates and wraps the result', async () => {
    const profile = createMockTechnicianProfile({ phone: '999' });
    service.updateProfile.mockResolvedValue(profile);
    const result = await controller.updateProfile('tech-1', { phone: '999' }, caller);
    expect(service.updateProfile).toHaveBeenCalledWith('tech-1', { phone: '999' }, caller);
    expect(result).toEqual({ success: true, data: profile });
  });

  it('getOnboardingStatus wraps the result', async () => {
    const status = { status: 'pending', checklist: {}, completedSteps: 0, totalSteps: 3 };
    service.getOnboardingStatus.mockResolvedValue(status);
    const result = await controller.getOnboardingStatus('tech-1', caller);
    expect(result).toEqual({ success: true, data: status });
  });
});
