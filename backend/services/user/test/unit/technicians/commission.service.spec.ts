import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { type JwtUser } from '@bitcrm/types';
import { CommissionService } from '../../../src/technicians/commission/commission.service';
import {
  createMockCommissionRepository,
  createMockRolesServiceByPriority,
  createMockSnsPublisher,
  createMockCommissionConfig,
} from '../mocks';

const caller = (roleId: string, id = 'caller-1'): JwtUser => ({
  id,
  cognitoSub: 'sub',
  email: 'x@test.com',
  roleId,
  department: 'HVAC',
});

describe('CommissionService (unit)', () => {
  let repo: ReturnType<typeof createMockCommissionRepository>;
  let roles: ReturnType<typeof createMockRolesServiceByPriority>;
  let sns: ReturnType<typeof createMockSnsPublisher>;
  let service: CommissionService;

  beforeEach(() => {
    repo = createMockCommissionRepository();
    roles = createMockRolesServiceByPriority();
    sns = createMockSnsPublisher();
    service = new CommissionService(repo as never, roles as never, sns as never);
  });

  describe('getConfig', () => {
    it('returns the latest config to self', async () => {
      repo.getLatest.mockResolvedValue(createMockCommissionConfig({ userId: 'tech-1' }));
      const r = await service.getConfig('tech-1', caller('role-technician', 'tech-1'));
      expect(r.baseRatePct).toBe(40);
    });

    it('forbids another technician', async () => {
      await expect(
        service.getConfig('tech-2', caller('role-technician', 'tech-1')),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('throws NotFound when no config exists', async () => {
      repo.getLatest.mockResolvedValue(null);
      await expect(service.getConfig('tech-1', caller('role-admin'))).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('setConfig', () => {
    it('forbids a non-manager', async () => {
      await expect(
        service.setConfig('tech-1', { baseRatePct: 40 }, caller('role-technician', 'tech-1')),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('creates a new version with defaults and publishes commission.updated', async () => {
      const r = await service.setConfig(
        'tech-1',
        { baseRatePct: 45 },
        caller('role-admin', 'mgr-1'),
      );
      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'tech-1',
          baseRatePct: 45,
          creditCardFeePct: 3,
          achFeePct: 0,
          createdBy: 'mgr-1',
        }),
      );
      expect(r.baseRatePct).toBe(45);
      expect(sns.publish).toHaveBeenCalledWith(
        'user-events',
        'commission.updated',
        expect.objectContaining({ technicianId: 'tech-1', baseRatePct: 45 }),
      );
    });
  });

  describe('calculate', () => {
    it('computes the EPIC-6 payout from the latest config', async () => {
      repo.getLatest.mockResolvedValue(
        createMockCommissionConfig({ baseRatePct: 40, creditCardFeePct: 3, achFeePct: 0 }),
      );
      const r = await service.calculate(
        'tech-1',
        { revenue: 350, tax: 28, partsCost: 45, paidByCard: true },
        caller('role-admin'),
      );
      expect(r.netPayout).toBe(100.3);
    });

    it('throws NotFound when the technician has no commission config', async () => {
      repo.getLatest.mockResolvedValue(null);
      await expect(
        service.calculate('tech-1', { revenue: 1, tax: 0, partsCost: 0, paidByCard: false }, caller('role-admin')),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('getHistory', () => {
    it('returns history to a manager', async () => {
      repo.listHistory.mockResolvedValue([createMockCommissionConfig()]);
      const r = await service.getHistory('tech-1', caller('role-admin'));
      expect(r).toHaveLength(1);
    });
  });
});
