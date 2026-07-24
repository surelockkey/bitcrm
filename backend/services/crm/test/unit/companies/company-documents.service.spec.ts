import { NotFoundException } from '@nestjs/common';
import { CompanyDocumentType, type JwtUser } from '@bitcrm/types';
import { CompanyDocumentsService } from 'src/companies/documents/company-documents.service';

const caller: JwtUser = {
  id: 'admin-1', cognitoSub: 'sub', email: 'a@x.com', roleId: 'role-admin', department: 'HQ',
};

describe('CompanyDocumentsService', () => {
  let s3: { getPresignedUpload: jest.Mock; getPresignedDownloadUrl: jest.Mock; deleteObject: jest.Mock };
  let repo: { upsert: jest.Mock; getByType: jest.Mock; listByCompany: jest.Mock; delete: jest.Mock };
  let service: CompanyDocumentsService;

  beforeEach(() => {
    s3 = {
      getPresignedUpload: jest.fn().mockResolvedValue({ url: 'https://s3/upload', headers: { 'Content-Type': 'application/pdf' } }),
      getPresignedDownloadUrl: jest.fn().mockResolvedValue('https://s3/download'),
      deleteObject: jest.fn().mockResolvedValue(undefined),
    };
    repo = {
      upsert: jest.fn().mockResolvedValue(undefined),
      getByType: jest.fn().mockResolvedValue({ companyId: 'c1', docType: 'w9', s3Key: 'companies/c1/w9', contentType: 'application/pdf', uploadedBy: 'admin-1', uploadedAt: 't' }),
      listByCompany: jest.fn().mockResolvedValue([]),
      delete: jest.fn().mockResolvedValue(undefined),
    };
    service = new CompanyDocumentsService(s3 as never, repo as never);
  });

  describe('requestUpload', () => {
    it('returns an SSE-KMS presigned URL and persists metadata', async () => {
      const res = await service.requestUpload('c1', { docType: CompanyDocumentType.W9, contentType: 'application/pdf' }, caller);

      expect(res.uploadUrl).toBe('https://s3/upload');
      expect(res.headers).toEqual({ 'Content-Type': 'application/pdf' });
      expect(s3.getPresignedUpload).toHaveBeenCalledWith(
        'companies/c1/w9',
        expect.objectContaining({ contentType: 'application/pdf' }),
      );
      expect(repo.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ companyId: 'c1', docType: CompanyDocumentType.W9, uploadedBy: 'admin-1' }),
      );
    });
  });

  describe('getDownloadUrl', () => {
    it('returns a short-TTL presigned download URL', async () => {
      const res = await service.getDownloadUrl('c1', CompanyDocumentType.W9);
      expect(res.downloadUrl).toBe('https://s3/download');
      expect(s3.getPresignedDownloadUrl).toHaveBeenCalledWith('companies/c1/w9', 300);
    });
    it('404s when the document is missing', async () => {
      repo.getByType.mockResolvedValue(null);
      await expect(service.getDownloadUrl('c1', CompanyDocumentType.COI)).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('list', () => {
    it('returns document metadata (no s3 keys leaked)', async () => {
      repo.listByCompany.mockResolvedValue([
        { companyId: 'c1', docType: 'w9', s3Key: 'k', contentType: 'application/pdf', uploadedBy: 'admin-1', uploadedAt: 't' },
      ]);
      const res = await service.list('c1');
      expect(res).toEqual([{ docType: 'w9', contentType: 'application/pdf', uploadedAt: 't' }]);
    });
  });

  describe('delete', () => {
    it('removes the S3 object and metadata', async () => {
      await service.delete('c1', CompanyDocumentType.W9);
      expect(s3.deleteObject).toHaveBeenCalledWith('companies/c1/w9');
      expect(repo.delete).toHaveBeenCalledWith('c1', CompanyDocumentType.W9);
    });
    it('404s when the document is missing', async () => {
      repo.getByType.mockResolvedValue(null);
      await expect(service.delete('c1', CompanyDocumentType.COI)).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
