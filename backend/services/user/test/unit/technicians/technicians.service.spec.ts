import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { type JwtUser } from '@bitcrm/types';
import { TechniciansService } from '../../../src/technicians/technicians.service';
import {
  createMockTechniciansRepository,
  createMockTechniciansCacheService,
  createMockRolesServiceByPriority,
  createMockSnsPublisher,
  createMockTechnicianProfile,
} from '../mocks';

function caller(roleId: string, id = 'caller-1'): JwtUser {
  return { id, cognitoSub: 'sub', email: 'x@test.com', roleId, department: 'HVAC' };
}

describe('TechniciansService (unit)', () => {
  let repo: ReturnType<typeof createMockTechniciansRepository>;
  let cache: ReturnType<typeof createMockTechniciansCacheService>;
  let roles: ReturnType<typeof createMockRolesServiceByPriority>;
  let sns: ReturnType<typeof createMockSnsPublisher>;
  let service: TechniciansService;

  beforeEach(() => {
    repo = createMockTechniciansRepository();
    cache = createMockTechniciansCacheService();
    roles = createMockRolesServiceByPriority();
    sns = createMockSnsPublisher();
    service = new TechniciansService(
      repo as never,
      cache as never,
      roles as never,
      sns as never,
    );
  });

  describe('getProfile', () => {
    it('returns the profile to a privileged caller (dispatcher viewing a tech)', async () => {
      cache.getProfile.mockResolvedValue(null);
      repo.getProfile.mockResolvedValue(createMockTechnicianProfile({ userId: 'tech-9' }));
      const result = await service.getProfile('tech-9', caller('role-dispatcher'));
      expect(result.userId).toBe('tech-9');
      expect(cache.setProfile).toHaveBeenCalled();
    });

    it('returns own profile to the technician (self)', async () => {
      cache.getProfile.mockResolvedValue(createMockTechnicianProfile({ userId: 'tech-1' }));
      const result = await service.getProfile('tech-1', caller('role-technician', 'tech-1'));
      expect(result.userId).toBe('tech-1');
    });

    it('forbids a technician from reading another technician profile', async () => {
      await expect(
        service.getProfile('tech-2', caller('role-technician', 'tech-1')),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(repo.getProfile).not.toHaveBeenCalled();
    });

    it('throws NotFound when no profile exists', async () => {
      cache.getProfile.mockResolvedValue(null);
      repo.getProfile.mockResolvedValue(null);
      await expect(
        service.getProfile('ghost', caller('role-admin')),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('updateProfile', () => {
    it('lets a technician edit their own self-fill fields and publishes tech.updated', async () => {
      repo.getProfile.mockResolvedValue(createMockTechnicianProfile({ userId: 'tech-1' }));
      repo.updateProfile.mockResolvedValue(
        createMockTechnicianProfile({ userId: 'tech-1', phone: '999' }),
      );
      await service.updateProfile('tech-1', { phone: '999' }, caller('role-technician', 'tech-1'));

      expect(repo.updateProfile).toHaveBeenCalledWith('tech-1', { phone: '999' });
      expect(cache.invalidateProfile).toHaveBeenCalledWith('tech-1');
      expect(sns.publish).toHaveBeenCalledWith(
        'user-events',
        'tech.updated',
        expect.objectContaining({ technicianId: 'tech-1', changedFields: ['phone'] }),
      );
    });

    it('forbids a technician from setting operational fields', async () => {
      repo.getProfile.mockResolvedValue(createMockTechnicianProfile({ userId: 'tech-1' }));
      await expect(
        service.updateProfile(
          'tech-1',
          { laborCostPerHour: 50 },
          caller('role-technician', 'tech-1'),
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(repo.updateProfile).not.toHaveBeenCalled();
    });

    it('lets a manager set operational fields', async () => {
      repo.getProfile.mockResolvedValue(createMockTechnicianProfile({ userId: 'tech-9' }));
      repo.updateProfile.mockResolvedValue(
        createMockTechnicianProfile({ userId: 'tech-9', status: 'active', laborCostPerHour: 45 }),
      );
      const result = await service.updateProfile(
        'tech-9',
        { status: 'active', laborCostPerHour: 45 },
        caller('role-admin'),
      );
      expect(result.status).toBe('active');
    });

    it('forbids a technician from editing another technician profile', async () => {
      await expect(
        service.updateProfile('tech-2', { phone: '1' }, caller('role-technician', 'tech-1')),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('creates a profile on first update when none exists', async () => {
      repo.getProfile.mockResolvedValue(null);
      await service.updateProfile('tech-1', { phone: '999' }, caller('role-technician', 'tech-1'));
      expect(repo.upsertProfile).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'tech-1', phone: '999', status: 'pending' }),
      );
      expect(repo.updateProfile).not.toHaveBeenCalled();
    });

    it('does not throw when the SNS publisher is absent', async () => {
      const noSns = new TechniciansService(repo as never, cache as never, roles as never);
      repo.getProfile.mockResolvedValue(createMockTechnicianProfile({ userId: 'tech-1' }));
      repo.updateProfile.mockResolvedValue(createMockTechnicianProfile({ userId: 'tech-1' }));
      await expect(
        noSns.updateProfile('tech-1', { phone: '5' }, caller('role-technician', 'tech-1')),
      ).resolves.toBeDefined();
    });
  });

  describe('getOnboardingStatus', () => {
    it('derives the checklist from the profile (self)', async () => {
      cache.getProfile.mockResolvedValue(
        createMockTechnicianProfile({
          userId: 'tech-1',
          homeAddress: { line1: '1 Main', city: 'Atlanta', state: 'GA', zip: '30301' },
          profilePhotoUrl: 'https://x/y.jpg',
        }),
      );
      const status = await service.getOnboardingStatus('tech-1', caller('role-technician', 'tech-1'));
      expect(status.checklist.profileComplete).toBe(true);
      expect(status.checklist.skillsApproved).toBe(false); // phase-2 stub
      expect(status.totalSteps).toBe(3);
    });
  });

  describe('list', () => {
    it('returns a paginated envelope for a privileged caller', async () => {
      repo.listAll.mockResolvedValue({ items: [createMockTechnicianProfile()], nextCursor: 'c' });
      const result = await service.list({ limit: 20 }, caller('role-admin'));
      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(1);
      expect(result.pagination).toEqual({ nextCursor: 'c', count: 1 });
    });

    it('filters by status when provided', async () => {
      repo.listByStatus.mockResolvedValue({ items: [], nextCursor: undefined });
      await service.list({ status: 'active', limit: 20 }, caller('role-admin'));
      expect(repo.listByStatus).toHaveBeenCalledWith('active', 20, undefined);
    });

    it('forbids a non-privileged caller from listing', async () => {
      await expect(
        service.list({ limit: 20 }, caller('role-technician', 'tech-1')),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });
});
