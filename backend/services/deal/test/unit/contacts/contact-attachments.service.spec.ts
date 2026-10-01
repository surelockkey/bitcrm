import { NotFoundException } from '@nestjs/common';
import { type JwtUser } from '@bitcrm/types';
import { ContactAttachmentsService } from 'src/contacts/contact-attachments.service';
import { createMockDeal } from '../mocks';

const caller: JwtUser = { id: 'disp-1', cognitoSub: 'sub', email: 'd@x.com', roleId: 'role-dispatcher', department: 'HQ' };

const clientFile = {
  contactId: 'c1',
  id: 'att-9',
  fileName: 'contract.pdf',
  contentType: 'application/pdf',
  size: 10,
  s3Key: 'contacts/c1/attachments/att-9',
  uploadedBy: 'disp-1',
  uploadedAt: '2026-07-31T10:00:00.000Z',
};

const jobFile = {
  dealId: 'd1',
  contactId: 'c1',
  id: 'att-1',
  fileName: 'before.jpg',
  contentType: 'image/jpeg',
  category: 'before',
  s3Key: 'deals/d1/attachments/att-1',
  uploadedBy: 'disp-1',
  uploadedAt: '2026-07-30T10:00:00.000Z',
};

/**
 * The client card's Files: every file of the client's jobs plus the files
 * uploaded on the client itself (Workiz's "Upload file" on the client card),
 * one list newest first; and the client's own files' presign / download /
 * rename / delete, mirroring the job attachment flow.
 */
describe('ContactAttachmentsService', () => {
  let s3: { getPresignedUpload: jest.Mock; getPresignedDownloadUrl: jest.Mock; deleteObject: jest.Mock };
  let repo: {
    listByContact: jest.Mock;
    createForContact: jest.Mock;
    getForContact: jest.Mock;
    updateForContact: jest.Mock;
    deleteForContact: jest.Mock;
  };
  let deals: { findByIds: jest.Mock };
  let service: ContactAttachmentsService;

  beforeEach(() => {
    s3 = {
      getPresignedUpload: jest.fn().mockResolvedValue({ url: 'https://s3/upload', headers: { 'Content-Type': 'application/pdf' } }),
      getPresignedDownloadUrl: jest.fn().mockResolvedValue('https://s3/download'),
      deleteObject: jest.fn().mockResolvedValue(undefined),
    };
    repo = {
      listByContact: jest.fn().mockResolvedValue({ items: [], nextCursor: undefined }),
      createForContact: jest.fn().mockResolvedValue(undefined),
      getForContact: jest.fn().mockResolvedValue(clientFile),
      updateForContact: jest.fn().mockResolvedValue(clientFile),
      deleteForContact: jest.fn().mockResolvedValue(undefined),
    };
    deals = { findByIds: jest.fn().mockResolvedValue([createMockDeal({ id: 'd1', dealNumber: 'NU8GUR' })]) };
    service = new ContactAttachmentsService(s3 as never, repo as never, deals as never);
  });

  describe('listByContact', () => {
    it('lists job files and the client’s own together, job files labelled with their job, no S3 keys', async () => {
      repo.listByContact.mockResolvedValue({ items: [clientFile, jobFile], nextCursor: 'next' });

      const page = await service.listByContact('c1', 30, 'cur');

      expect(repo.listByContact).toHaveBeenCalledWith('c1', 30, 'cur');
      expect(deals.findByIds).toHaveBeenCalledWith(['d1']);
      expect(page.nextCursor).toBe('next');
      expect(page.items).toEqual([
        {
          id: 'att-9',
          contactId: 'c1',
          fileName: 'contract.pdf',
          contentType: 'application/pdf',
          size: 10,
          category: undefined,
          description: undefined,
          uploadedBy: 'disp-1',
          uploadedAt: '2026-07-31T10:00:00.000Z',
        },
        expect.objectContaining({ id: 'att-1', contactId: 'c1', dealId: 'd1', dealNumber: 'NU8GUR', category: 'before' }),
      ]);
      for (const item of page.items) expect(item).not.toHaveProperty('s3Key');
      // The client's own file names no job at all — that is what tells the web to use the contact download route.
      expect(page.items[0]).not.toHaveProperty('dealId');
    });

    it('skips the job lookup when the page has only the client’s own files', async () => {
      repo.listByContact.mockResolvedValue({ items: [clientFile], nextCursor: undefined });
      await service.listByContact('c1', 30);
      expect(deals.findByIds).not.toHaveBeenCalled();
    });
  });

  describe('requestUpload', () => {
    it('presigns under contacts/<contactId>/attachments/<id> and stores the row on the client', async () => {
      const res = await service.requestUpload('c1', { fileName: 'contract.pdf', contentType: 'application/pdf', size: 10 }, caller);

      expect(res).toEqual({
        id: expect.any(String),
        uploadUrl: 'https://s3/upload',
        s3Key: `contacts/c1/attachments/${res.id}`,
        headers: { 'Content-Type': 'application/pdf' },
      });
      expect(s3.getPresignedUpload).toHaveBeenCalledWith(
        `contacts/c1/attachments/${res.id}`,
        expect.objectContaining({ contentType: 'application/pdf', kmsKeyId: expect.any(String) }),
      );
      expect(repo.createForContact).toHaveBeenCalledWith({
        contactId: 'c1',
        id: res.id,
        fileName: 'contract.pdf',
        contentType: 'application/pdf',
        size: 10,
        category: undefined,
        s3Key: `contacts/c1/attachments/${res.id}`,
        uploadedBy: 'disp-1',
        uploadedAt: expect.any(String),
      });
    });
  });

  describe('getDownloadUrl', () => {
    it('presigns a 5-minute GET of the stored key', async () => {
      await expect(service.getDownloadUrl('c1', 'att-9')).resolves.toEqual({ downloadUrl: 'https://s3/download' });
      expect(repo.getForContact).toHaveBeenCalledWith('c1', 'att-9');
      expect(s3.getPresignedDownloadUrl).toHaveBeenCalledWith('contacts/c1/attachments/att-9', 300);
    });

    it('404s when the file is not the client’s', async () => {
      repo.getForContact.mockResolvedValue(null);
      await expect(service.getDownloadUrl('c1', 'nope')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('update', () => {
    it('renames / redescribes and returns meta without the key', async () => {
      repo.updateForContact.mockResolvedValue({ ...clientFile, fileName: 'signed.pdf', description: 'Signed copy' });
      const res = await service.update('c1', 'att-9', { fileName: 'signed.pdf', description: 'Signed copy' }, caller);
      expect(repo.updateForContact).toHaveBeenCalledWith('c1', 'att-9', { fileName: 'signed.pdf', description: 'Signed copy' });
      expect(res).toMatchObject({ id: 'att-9', fileName: 'signed.pdf', description: 'Signed copy' });
      expect(res).not.toHaveProperty('s3Key');
    });

    it('404s on a missing file and writes nothing', async () => {
      repo.getForContact.mockResolvedValue(null);
      await expect(service.update('c1', 'nope', { fileName: 'x' }, caller)).rejects.toBeInstanceOf(NotFoundException);
      expect(repo.updateForContact).not.toHaveBeenCalled();
    });
  });

  describe('delete', () => {
    it('removes the object and the row', async () => {
      await service.delete('c1', 'att-9', caller);
      expect(s3.deleteObject).toHaveBeenCalledWith('contacts/c1/attachments/att-9');
      expect(repo.deleteForContact).toHaveBeenCalledWith('c1', 'att-9');
    });

    it('404s on a missing file and touches nothing', async () => {
      repo.getForContact.mockResolvedValue(null);
      await expect(service.delete('c1', 'nope', caller)).rejects.toBeInstanceOf(NotFoundException);
      expect(s3.deleteObject).not.toHaveBeenCalled();
      expect(repo.deleteForContact).not.toHaveBeenCalled();
    });
  });
});
