import { ForbiddenException, BadRequestException } from '@nestjs/common';
import { type JwtUser } from '@bitcrm/types';
import { TechnicianSkillsService } from '../../../src/technicians/skills/technician-skills.service';
import {
  createMockTechnicianSkillsRepository,
  createMockRolesServiceByPriority,
  createMockSnsPublisher,
  createMockTechnicianSkill,
} from '../mocks';

const caller = (roleId: string, id = 'caller-1'): JwtUser => ({
  id,
  cognitoSub: 'sub',
  email: 'x@test.com',
  roleId,
  department: 'HVAC',
});

describe('TechnicianSkillsService (unit)', () => {
  let repo: ReturnType<typeof createMockTechnicianSkillsRepository>;
  let roles: ReturnType<typeof createMockRolesServiceByPriority>;
  let sns: ReturnType<typeof createMockSnsPublisher>;
  let service: TechnicianSkillsService;

  beforeEach(() => {
    repo = createMockTechnicianSkillsRepository();
    roles = createMockRolesServiceByPriority();
    sns = createMockSnsPublisher();
    service = new TechnicianSkillsService(repo as never, roles as never, sns as never);
  });

  describe('propose', () => {
    it('lets a technician propose job types + service areas (self)', async () => {
      repo.listByUser.mockResolvedValue([]);
      await service.propose(
        'tech-1',
        { jobTypes: ['Locksmith', 'Rekeying'], serviceAreas: ['Atlanta'] },
        caller('role-technician', 'tech-1'),
      );
      expect(repo.create).toHaveBeenCalledTimes(3);
      expect(sns.publish).toHaveBeenCalledWith(
        'user-events',
        'skill.proposed',
        expect.objectContaining({ technicianId: 'tech-1' }),
      );
    });

    it('forbids proposing for another technician', async () => {
      await expect(
        service.propose('tech-2', { jobTypes: ['X'], serviceAreas: [] }, caller('role-technician', 'tech-1')),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('skips duplicates of an existing non-rejected skill', async () => {
      repo.listByUser.mockResolvedValue([
        createMockTechnicianSkill({ type: 'job_type', value: 'Locksmith', status: 'approved' }),
      ]);
      await service.propose(
        'tech-1',
        { jobTypes: ['Locksmith', 'Rekeying'], serviceAreas: [] },
        caller('role-technician', 'tech-1'),
      );
      expect(repo.create).toHaveBeenCalledTimes(1); // only Rekeying
    });
  });

  describe('listAssignableTechnicians', () => {
    it('returns techs with ≥1 approved job type AND service area', async () => {
      repo.listAllApproved = jest.fn().mockResolvedValue([
        createMockTechnicianSkill({ userId: 't1', type: 'job_type', value: 'Locksmith', status: 'approved' }),
        createMockTechnicianSkill({ userId: 't1', type: 'service_area', value: 'Atlanta', status: 'approved' }),
        createMockTechnicianSkill({ userId: 't2', type: 'job_type', value: 'Rekeying', status: 'approved' }), // no area
      ]);
      const out = await service.listAssignableTechnicians();
      expect(out).toEqual([
        { technicianId: 't1', approvedSkills: ['Locksmith'], serviceAreas: ['Atlanta'] },
      ]);
    });
  });

  describe('getEligibility', () => {
    it('derives assignable from a single tech’s approved skills', async () => {
      repo.listByUser.mockResolvedValue([
        createMockTechnicianSkill({ type: 'job_type', value: 'Locksmith', status: 'approved' }),
        createMockTechnicianSkill({ type: 'service_area', value: 'Atlanta', status: 'approved' }),
        createMockTechnicianSkill({ type: 'job_type', value: 'Rekeying', status: 'pending' }),
      ]);
      const out = await service.getEligibility('tech-1');
      expect(out).toEqual({
        technicianId: 'tech-1',
        assignable: true,
        approvedSkills: ['Locksmith'],
        serviceAreas: ['Atlanta'],
      });
    });

    it('is not assignable without an approved service area', async () => {
      repo.listByUser.mockResolvedValue([
        createMockTechnicianSkill({ type: 'job_type', value: 'Locksmith', status: 'approved' }),
      ]);
      expect((await service.getEligibility('tech-1')).assignable).toBe(false);
    });
  });

  describe('listPending', () => {
    it('is manager-only', async () => {
      await expect(service.listPending(caller('role-technician', 'tech-1'))).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      repo.listPendingAcrossTechs.mockResolvedValue({ items: [], nextCursor: undefined });
      await expect(service.listPending(caller('role-admin'))).resolves.toBeDefined();
    });
  });

  describe('approve', () => {
    it('forbids a non-manager', async () => {
      await expect(
        service.approve('tech-1', 'sk-1', {}, caller('role-technician', 'tech-1')),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('approves and sets review fields', async () => {
      repo.getById.mockResolvedValue(createMockTechnicianSkill({ status: 'pending' }));
      repo.updateStatus.mockResolvedValue(createMockTechnicianSkill({ status: 'approved' }));
      repo.listByUser.mockResolvedValue([createMockTechnicianSkill({ status: 'approved' })]);

      await service.approve('tech-1', 'sk-1', { comments: 'ok' }, caller('role-admin', 'mgr-1'));

      expect(repo.updateStatus).toHaveBeenCalledWith(
        'tech-1',
        'sk-1',
        expect.objectContaining({ status: 'approved', reviewedBy: 'mgr-1', comments: 'ok' }),
      );
    });

    it('publishes tech.approved when the technician first becomes assignable', async () => {
      // approving a service_area while a job_type is already approved → assignable
      repo.getById.mockResolvedValue(
        createMockTechnicianSkill({ skillId: 'area-1', type: 'service_area', value: 'Atlanta', status: 'pending' }),
      );
      repo.updateStatus.mockResolvedValue(
        createMockTechnicianSkill({ skillId: 'area-1', type: 'service_area', value: 'Atlanta', status: 'approved' }),
      );
      repo.listByUser.mockResolvedValue([
        createMockTechnicianSkill({ skillId: 'job-1', type: 'job_type', value: 'Locksmith', status: 'approved' }),
        createMockTechnicianSkill({ skillId: 'area-1', type: 'service_area', value: 'Atlanta', status: 'approved' }),
      ]);

      await service.approve('tech-1', 'area-1', {}, caller('role-admin', 'mgr-1'));

      expect(sns.publish).toHaveBeenCalledWith(
        'user-events',
        'tech.approved',
        expect.objectContaining({
          technicianId: 'tech-1',
          approvedSkills: ['Locksmith'],
          serviceAreas: ['Atlanta'],
        }),
      );
    });

    it('does NOT publish tech.approved when not yet assignable', async () => {
      repo.getById.mockResolvedValue(createMockTechnicianSkill({ type: 'job_type', status: 'pending' }));
      repo.updateStatus.mockResolvedValue(createMockTechnicianSkill({ type: 'job_type', status: 'approved' }));
      repo.listByUser.mockResolvedValue([createMockTechnicianSkill({ type: 'job_type', status: 'approved' })]);

      await service.approve('tech-1', 'sk-1', {}, caller('role-admin', 'mgr-1'));

      const calls = sns.publish.mock.calls.map((c) => c[1]);
      expect(calls).not.toContain('tech.approved');
    });

    it('throws NotFound semantics when skill is missing', async () => {
      repo.getById.mockResolvedValue(null);
      await expect(service.approve('tech-1', 'nope', {}, caller('role-admin'))).rejects.toThrow();
    });
  });

  describe('reject', () => {
    it('requires comments', async () => {
      repo.getById.mockResolvedValue(createMockTechnicianSkill());
      await expect(
        service.reject('tech-1', 'sk-1', {}, caller('role-admin')),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects with comments', async () => {
      repo.getById.mockResolvedValue(createMockTechnicianSkill());
      repo.updateStatus.mockResolvedValue(createMockTechnicianSkill({ status: 'rejected' }));
      await service.reject('tech-1', 'sk-1', { comments: 'not verified' }, caller('role-admin', 'mgr-1'));
      expect(repo.updateStatus).toHaveBeenCalledWith(
        'tech-1',
        'sk-1',
        expect.objectContaining({ status: 'rejected', comments: 'not verified' }),
      );
    });
  });

  describe('revoke', () => {
    it('manager revokes an approved skill and emits tech.updated', async () => {
      repo.getById.mockResolvedValue(createMockTechnicianSkill({ status: 'approved' }));
      await service.revoke('tech-1', 'sk-1', caller('role-admin', 'mgr-1'));
      expect(repo.delete).toHaveBeenCalledWith('tech-1', 'sk-1');
      expect(sns.publish).toHaveBeenCalledWith('user-events', 'tech.updated', expect.any(Object));
    });

    it('forbids a technician from revoking', async () => {
      await expect(
        service.revoke('tech-1', 'sk-1', caller('role-technician', 'tech-1')),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('assignServiceAreas', () => {
    it('lets a manager assign approved service areas directly', async () => {
      repo.listByUser.mockResolvedValue([]);
      const created = await service.assignServiceAreas(
        'tech-1',
        ['Atlanta Metro', 'North Georgia'],
        caller('role-admin', 'mgr-1'),
      );

      expect(created).toHaveLength(2);
      expect(repo.create).toHaveBeenCalledTimes(2);
      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'service_area',
          value: 'Atlanta Metro',
          status: 'approved',
          reviewedBy: 'mgr-1',
        }),
      );
      expect(sns.publish).toHaveBeenCalledWith(
        'user-events',
        'tech.updated',
        expect.objectContaining({ technicianId: 'tech-1' }),
      );
    });

    it('forbids a technician from assigning service areas', async () => {
      await expect(
        service.assignServiceAreas('tech-1', ['Atlanta'], caller('role-technician', 'tech-1')),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(repo.create).not.toHaveBeenCalled();
    });

    it('skips duplicates of an existing non-rejected area', async () => {
      repo.listByUser.mockResolvedValue([
        createMockTechnicianSkill({ type: 'service_area', value: 'Atlanta Metro', status: 'approved' }),
      ]);
      const created = await service.assignServiceAreas(
        'tech-1',
        ['Atlanta Metro', 'North Georgia'],
        caller('role-admin', 'mgr-1'),
      );
      expect(created).toHaveLength(1); // only North Georgia
      expect(created[0].value).toBe('North Georgia');
    });

    it('publishes tech.approved when the area tips the tech into assignable', async () => {
      // Already has an approved job type; assigning the first area makes them assignable.
      const jobSkill = createMockTechnicianSkill({ type: 'job_type', value: 'Locksmith', status: 'approved' });
      repo.listByUser
        .mockResolvedValueOnce([jobSkill]) // dedupe read (no areas yet)
        .mockResolvedValueOnce([
          jobSkill,
          createMockTechnicianSkill({ skillId: 'new-area', type: 'service_area', value: 'Atlanta Metro', status: 'approved' }),
        ]); // post-create read used by publishIfNewlyAssignable
      repo.create.mockImplementation(async (s: { skillId: string }) => {
        // force the created skill id so the before/after diff sees it as new
        s.skillId = 'new-area';
      });

      await service.assignServiceAreas('tech-1', ['Atlanta Metro'], caller('role-admin', 'mgr-1'));

      expect(sns.publish).toHaveBeenCalledWith(
        'user-events',
        'tech.approved',
        expect.objectContaining({ technicianId: 'tech-1', serviceAreas: ['Atlanta Metro'] }),
      );
    });

    it('does not publish tech.approved when no job type is approved yet', async () => {
      repo.listByUser
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([
          createMockTechnicianSkill({ skillId: 'a1', type: 'service_area', value: 'Atlanta Metro', status: 'approved' }),
        ]);
      await service.assignServiceAreas('tech-1', ['Atlanta Metro'], caller('role-admin', 'mgr-1'));

      const approvedCalls = sns.publish.mock.calls.filter((c: unknown[]) => c[1] === 'tech.approved');
      expect(approvedCalls).toHaveLength(0);
    });
  });
});
