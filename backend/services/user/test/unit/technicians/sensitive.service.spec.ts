import { ForbiddenException } from '@nestjs/common';
import { type JwtUser } from '@bitcrm/types';
import { SensitiveService } from '../../../src/technicians/documents/sensitive.service';
import {
  createMockKmsService,
  createMockSensitiveRepository,
  createMockAuditRepository,
  createMockRolesServiceByPriority,
  createMockSnsPublisher,
} from '../mocks';

const caller = (roleId: string, id = 'caller-1'): JwtUser => ({
  id,
  cognitoSub: 'sub',
  email: 'x@test.com',
  roleId,
  department: 'HVAC',
});

describe('SensitiveService (unit)', () => {
  let kms: ReturnType<typeof createMockKmsService>;
  let repo: ReturnType<typeof createMockSensitiveRepository>;
  let audit: ReturnType<typeof createMockAuditRepository>;
  let roles: ReturnType<typeof createMockRolesServiceByPriority>;
  let sns: ReturnType<typeof createMockSnsPublisher>;
  let service: SensitiveService;

  beforeEach(() => {
    kms = createMockKmsService();
    repo = createMockSensitiveRepository();
    audit = createMockAuditRepository();
    roles = createMockRolesServiceByPriority();
    sns = createMockSnsPublisher();
    service = new SensitiveService(kms as never, repo as never, audit as never, roles as never, sns as never);
  });

  describe('setSensitive', () => {
    it('encrypts SSN + bank for the technician (self) and stores ciphertext', async () => {
      await service.setSensitive(
        'tech-1',
        { ssn: '123-45-6789', bankAccount: '000111222' },
        caller('role-technician', 'tech-1'),
      );
      expect(kms.encrypt).toHaveBeenCalledWith('123-45-6789');
      expect(kms.encrypt).toHaveBeenCalledWith('000111222');
      expect(repo.upsert).toHaveBeenCalledWith(
        'tech-1',
        expect.objectContaining({ ssnEncrypted: 'ENC(123-45-6789)', bankAccountEncrypted: 'ENC(000111222)' }),
      );
      expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'sensitive.updated' }));
    });

    it('forbids setting another technician’s sensitive data', async () => {
      await expect(
        service.setSensitive('tech-2', { ssn: '1' }, caller('role-technician', 'tech-1')),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('getSensitive', () => {
    beforeEach(() => {
      repo.get.mockResolvedValue({ ssnEncrypted: 'ENC(123-45-6789)', bankAccountEncrypted: 'ENC(000111222)' });
    });

    it('returns MASKED values to a manager (dept-manager) + audits', async () => {
      const out = await service.getSensitive('tech-1', caller('role-dept-manager', 'mgr-1'));
      expect(out.ssn).toBe('•••••••6789');
      expect(out.bankAccount).toBe('•••••2222'.length ? out.bankAccount : '');
      expect(out.masked).toBe(true);
      expect(kms.decrypt).toHaveBeenCalled();
      expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'sensitive.read' }));
    });

    it('returns MASKED values to the technician themselves', async () => {
      const out = await service.getSensitive('tech-1', caller('role-technician', 'tech-1'));
      expect(out.masked).toBe(true);
      expect(out.ssn?.startsWith('•')).toBe(true);
    });

    it('returns FULL plaintext to Admin+ (audited)', async () => {
      const out = await service.getSensitive('tech-1', caller('role-admin', 'admin-1'));
      expect(out.masked).toBe(false);
      expect(out.ssn).toBe('123-45-6789');
      expect(out.bankAccount).toBe('000111222');
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'sensitive.read', resource: 'ssn,bankAccount' }),
      );
    });

    it('forbids an unrelated technician', async () => {
      await expect(
        service.getSensitive('tech-2', caller('role-technician', 'tech-1')),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('returns nulls when nothing is stored', async () => {
      repo.get.mockResolvedValue(null);
      const out = await service.getSensitive('tech-1', caller('role-admin'));
      expect(out).toEqual({ ssn: null, bankAccount: null, masked: false });
    });
  });

  describe('getBankAccountInternal', () => {
    it('returns the decrypted bank account and writes an audit record', async () => {
      repo.get.mockResolvedValue({ bankAccountEncrypted: 'ENC(000111222)' });
      const out = await service.getBankAccountInternal('tech-1');
      expect(out).toBe('000111222');
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'sensitive.read', actorId: 'internal:payment-service' }),
      );
    });
  });
});
