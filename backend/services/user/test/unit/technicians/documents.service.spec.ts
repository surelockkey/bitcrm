import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { type JwtUser } from '@bitcrm/types';
import { DocumentsService } from '../../../src/technicians/documents/documents.service';
import {
  createMockS3Service,
  createMockDocumentsRepository,
  createMockAuditRepository,
  createMockRolesServiceByPriority,
  createMockSnsPublisher,
  createMockUsersRepository,
} from '../mocks';

const caller = (roleId: string, id = 'caller-1'): JwtUser => ({
  id,
  cognitoSub: 'sub',
  email: 'x@test.com',
  roleId,
  department: 'HVAC',
});

describe('DocumentsService (unit)', () => {
  let s3: ReturnType<typeof createMockS3Service>;
  let repo: ReturnType<typeof createMockDocumentsRepository>;
  let audit: ReturnType<typeof createMockAuditRepository>;
  let roles: ReturnType<typeof createMockRolesServiceByPriority>;
  let sns: ReturnType<typeof createMockSnsPublisher>;
  let users: ReturnType<typeof createMockUsersRepository>;
  let service: DocumentsService;

  beforeEach(() => {
    s3 = createMockS3Service();
    repo = createMockDocumentsRepository();
    audit = createMockAuditRepository();
    roles = createMockRolesServiceByPriority();
    sns = createMockSnsPublisher();
    users = createMockUsersRepository();
    process.env.DOCUMENTS_KMS_KEY_ID = 'alias/test';
    service = new DocumentsService(s3 as never, repo as never, audit as never, roles as never, users as never, sns as never);
  });

  describe('requestUpload', () => {
    it('lets a technician get an SSE-KMS presigned URL for their own document', async () => {
      const res = await service.requestUpload(
        'tech-1',
        { docType: 'drivers_license_front', contentType: 'image/jpeg' },
        caller('role-technician', 'tech-1'),
      );
      expect(res.uploadUrl).toBe('https://s3/upload');
      // The client is handed the exact headers it must replay on the PUT.
      expect(res.headers).toEqual({ 'Content-Type': 'image/png' });
      // SSE-KMS enforced
      expect(s3.getPresignedUpload).toHaveBeenCalledWith(
        'technicians/tech-1/drivers_license_front',
        expect.objectContaining({ contentType: 'image/jpeg', kmsKeyId: 'alias/test' }),
      );
      expect(repo.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'tech-1', docType: 'drivers_license_front' }),
      );
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'document.uploaded', actorId: 'tech-1' }),
      );
    });

    it('forbids uploading to another technician', async () => {
      await expect(
        service.requestUpload('tech-2', { docType: 'profile_photo', contentType: 'image/png' }, caller('role-technician', 'tech-1')),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('getDownloadUrl', () => {
    it('returns a presigned URL to a manager and writes an audit record', async () => {
      repo.getByType.mockResolvedValue({ userId: 'tech-1', docType: 'drivers_license_front', s3Key: 'technicians/tech-1/drivers_license_front' });
      const res = await service.getDownloadUrl('tech-1', 'drivers_license_front', caller('role-admin', 'mgr-1'));
      expect(res.downloadUrl).toBe('https://s3/download');
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'document.viewed', actorId: 'mgr-1', resource: 'drivers_license_front' }),
      );
      expect(sns.publish).toHaveBeenCalledWith('user-events', 'document.accessed', expect.any(Object));
    });

    it('forbids a technician from viewing another technician’s document', async () => {
      await expect(
        service.getDownloadUrl('tech-2', 'profile_photo', caller('role-technician', 'tech-1')),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('throws NotFound when the document does not exist', async () => {
      repo.getByType.mockResolvedValue(null);
      await expect(
        service.getDownloadUrl('tech-1', 'bank_document', caller('role-admin')),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('delete', () => {
    it('is Admin+ only and removes S3 object + metadata', async () => {
      repo.getByType.mockResolvedValue({ userId: 'tech-1', docType: 'bank_document', s3Key: 'technicians/tech-1/bank_document' });
      await service.delete('tech-1', 'bank_document', caller('role-admin', 'admin-1'));
      expect(s3.deleteObject).toHaveBeenCalledWith('technicians/tech-1/bank_document');
      expect(repo.delete).toHaveBeenCalledWith('tech-1', 'bank_document');
      expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'document.deleted' }));
    });

    it('forbids a manager (dept-manager) from deleting', async () => {
      repo.getByType.mockResolvedValue({ userId: 'tech-1', docType: 'bank_document', s3Key: 'k' });
      await expect(
        service.delete('tech-1', 'bank_document', caller('role-dept-manager', 'mgr-1')),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('getAuditTrail', () => {
    // Viewers (e.g. the technician themselves) may lack users.view, so the
    // client cannot join actor names — the service must resolve them.
    it('enriches rows with actor display names, one lookup per distinct actor', async () => {
      audit.listByUser.mockResolvedValue([
        { userId: 'tech-1', actorId: 'mgr-1', action: 'document.viewed', resource: 'profile_photo', timestamp: 't3' },
        { userId: 'tech-1', actorId: 'tech-1', action: 'document.uploaded', resource: 'profile_photo', timestamp: 't2' },
        { userId: 'tech-1', actorId: 'mgr-1', action: 'sensitive.read', resource: 'ssn', timestamp: 't1' },
      ]);
      users.findById.mockImplementation((id: string) =>
        Promise.resolve(
          id === 'mgr-1'
            ? { id: 'mgr-1', firstName: 'Dana', lastName: 'Reeves', email: 'dana@test.com' }
            : { id: 'tech-1', firstName: '', lastName: '', email: 'tech@test.com' },
        ),
      );

      const rows = await service.getAuditTrail('tech-1');

      expect(rows).toHaveLength(3);
      expect(rows[0].actorName).toBe('Dana Reeves');
      expect(rows[1].actorName).toBe('tech@test.com'); // empty name falls back to email
      expect(rows[2].actorName).toBe('Dana Reeves');
      expect(users.findById).toHaveBeenCalledTimes(2); // mgr-1 + tech-1, deduped
    });

    it('omits actorName for unknown actors and rows without an actor id', async () => {
      audit.listByUser.mockResolvedValue([
        { userId: 'tech-1', actorId: 'ghost', action: 'document.viewed', resource: 'x', timestamp: 't2' },
        { userId: 'tech-1', actorId: undefined, action: 'sensitive.read', resource: 'ssn', timestamp: 't1' },
      ]);
      users.findById.mockResolvedValue(null);

      const rows = await service.getAuditTrail('tech-1');

      expect(rows[0].actorName).toBeUndefined();
      expect(rows[1].actorName).toBeUndefined();
      expect(users.findById).toHaveBeenCalledTimes(1); // empty actorId is never looked up
    });

    it('still returns rows when an actor lookup fails', async () => {
      audit.listByUser.mockResolvedValue([
        { userId: 'tech-1', actorId: 'mgr-1', action: 'document.viewed', resource: 'x', timestamp: 't1' },
      ]);
      users.findById.mockRejectedValue(new Error('dynamo down'));

      const rows = await service.getAuditTrail('tech-1');

      expect(rows).toHaveLength(1);
      expect(rows[0].actorName).toBeUndefined();
    });
  });
});
