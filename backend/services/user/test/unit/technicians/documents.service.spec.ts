import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { type JwtUser } from '@bitcrm/types';
import { DocumentsService } from '../../../src/technicians/documents/documents.service';
import {
  createMockS3Service,
  createMockDocumentsRepository,
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

describe('DocumentsService (unit)', () => {
  let s3: ReturnType<typeof createMockS3Service>;
  let repo: ReturnType<typeof createMockDocumentsRepository>;
  let audit: ReturnType<typeof createMockAuditRepository>;
  let roles: ReturnType<typeof createMockRolesServiceByPriority>;
  let sns: ReturnType<typeof createMockSnsPublisher>;
  let service: DocumentsService;

  beforeEach(() => {
    s3 = createMockS3Service();
    repo = createMockDocumentsRepository();
    audit = createMockAuditRepository();
    roles = createMockRolesServiceByPriority();
    sns = createMockSnsPublisher();
    process.env.DOCUMENTS_KMS_KEY_ID = 'alias/test';
    service = new DocumentsService(s3 as never, repo as never, audit as never, roles as never, sns as never);
  });

  describe('requestUpload', () => {
    it('lets a technician get an SSE-KMS presigned URL for their own document', async () => {
      const res = await service.requestUpload(
        'tech-1',
        { docType: 'drivers_license_front', contentType: 'image/jpeg' },
        caller('role-technician', 'tech-1'),
      );
      expect(res.uploadUrl).toBe('https://s3/upload');
      // SSE-KMS enforced
      expect(s3.getPresignedUploadUrl).toHaveBeenCalledWith(
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
});
