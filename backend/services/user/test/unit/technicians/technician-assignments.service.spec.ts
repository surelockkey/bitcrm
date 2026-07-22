import { ForbiddenException } from '@nestjs/common';
import { UserEventType, type JwtUser } from '@bitcrm/types';
import { TechnicianAssignmentsService } from '../../../src/technicians/assignments/technician-assignments.service';
import { createMockTechnicianAssignmentsRepository } from '../mocks';

/**
 * Job types and service areas share one review flow. These guard the two things
 * most likely to break: the propose→approve permission split, and the rule that
 * `tech.approved` fires exactly once — on the not-assignable → assignable edge.
 */
describe('TechnicianAssignmentsService', () => {
  let repo: ReturnType<typeof createMockTechnicianAssignmentsRepository>;
  let roles: { findById: jest.Mock };
  let sns: { publish: jest.Mock };
  let service: TechnicianAssignmentsService;

  const manager: JwtUser = {
    id: 'mgr-1', cognitoSub: 's', email: 'm@x.com', roleId: 'role-manager', department: 'HQ',
  };
  const tech: JwtUser = {
    id: 'tech-1', cognitoSub: 's', email: 't@x.com', roleId: 'role-technician', department: 'Field',
  };

  const asAssignment = (over: Record<string, unknown>) => ({
    userId: 'tech-1', kind: 'job_type', catalogId: 'jt-1', status: 'approved',
    proposedBy: 'mgr-1', proposedAt: '2026-07-01T00:00:00.000Z', ...over,
  });

  beforeEach(() => {
    repo = createMockTechnicianAssignmentsRepository();
    // Manager outranks technician; super-admin short-circuit not needed here.
    roles = {
      findById: jest.fn((id: string) =>
        Promise.resolve(
          id === 'role-manager'
            ? { id, name: 'Manager', priority: 50, isSystem: false }
            : { id: 'role-technician', name: 'Technician', priority: 10, isSystem: false },
        ),
      ),
    };
    sns = { publish: jest.fn().mockResolvedValue(undefined) };
    service = new TechnicianAssignmentsService(repo as never, roles as never, sns as never);
  });

  describe('propose', () => {
    it('lets a technician propose their own job types (pending)', async () => {
      repo.listByUser.mockResolvedValue([]);
      const created = await service.propose('tech-1', 'job_type', ['jt-1'], tech);

      expect(created).toHaveLength(1);
      expect(repo.create).toHaveBeenCalledWith(expect.objectContaining({ status: 'pending', catalogId: 'jt-1' }));
    });

    it('forbids proposing for someone else', async () => {
      await expect(service.propose('tech-1', 'job_type', ['jt-1'], manager)).rejects.toThrow(ForbiddenException);
    });

    it('skips ids the technician already holds', async () => {
      repo.listByUser.mockResolvedValue([asAssignment({ status: 'pending' })]);
      const created = await service.propose('tech-1', 'job_type', ['jt-1'], tech);
      expect(created).toHaveLength(0);
      expect(repo.create).not.toHaveBeenCalled();
    });
  });

  describe('assign (manager direct-grant)', () => {
    it('creates already-approved rows', async () => {
      repo.listByUser.mockResolvedValue([]);
      await service.assign('tech-1', 'job_type', ['jt-1'], manager);
      expect(repo.create).toHaveBeenCalledWith(expect.objectContaining({ status: 'approved', reviewedBy: 'mgr-1' }));
    });

    it('forbids a technician from direct-granting', async () => {
      await expect(service.assign('tech-1', 'job_type', ['jt-1'], tech)).rejects.toThrow(ForbiddenException);
    });
  });

  describe('tech.approved publication', () => {
    it('publishes when the approval tips the technician into assignable', async () => {
      // Before: an approved area + a still-pending job type (so requireAll finds
      // it). Approving the job type crosses the assignable bar.
      repo.listByUser
        .mockResolvedValueOnce([
          asAssignment({ kind: 'service_area', catalogId: 'sa-1', status: 'approved' }),
          asAssignment({ kind: 'job_type', catalogId: 'jt-1', status: 'pending' }),
        ]) // requireAll (before)
        .mockResolvedValueOnce([
          asAssignment({ kind: 'service_area', catalogId: 'sa-1', status: 'approved' }),
          asAssignment({ kind: 'job_type', catalogId: 'jt-1', status: 'approved' }),
        ]); // after, inside publishIfNewlyAssignable
      repo.updateStatus.mockResolvedValue(asAssignment({}));

      await service.approve('tech-1', 'job_type', 'jt-1', {}, manager);

      const approvedCall = sns.publish.mock.calls.find((c) => c[1] === UserEventType.TECH_APPROVED);
      expect(approvedCall).toBeDefined();
      expect(approvedCall[2]).toMatchObject({
        technicianId: 'tech-1',
        jobTypeIds: ['jt-1'],
        serviceAreaIds: ['sa-1'],
      });
    });

    it('does NOT publish tech.approved when the technician was already assignable', async () => {
      const alreadyAssignable = [
        asAssignment({ kind: 'service_area', catalogId: 'sa-1' }),
        asAssignment({ kind: 'job_type', catalogId: 'jt-1' }),
      ];
      repo.listByUser.mockResolvedValue([...alreadyAssignable, asAssignment({ kind: 'job_type', catalogId: 'jt-2' })]);
      repo.updateStatus.mockResolvedValue(asAssignment({ catalogId: 'jt-2' }));

      await service.approve('tech-1', 'job_type', 'jt-2', {}, manager);

      expect(sns.publish.mock.calls.some((c) => c[1] === UserEventType.TECH_APPROVED)).toBe(false);
    });

    it('always emits tech.updated with the assignments marker', async () => {
      repo.listByUser.mockResolvedValue([asAssignment({})]);
      repo.updateStatus.mockResolvedValue(asAssignment({}));

      await service.approve('tech-1', 'job_type', 'jt-1', {}, manager);

      const updated = sns.publish.mock.calls.find((c) => c[1] === UserEventType.TECH_UPDATED);
      expect(updated[2]).toMatchObject({ technicianId: 'tech-1', changedFields: ['assignments'] });
    });
  });
});
