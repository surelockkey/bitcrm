import { NotFoundException } from '@nestjs/common';
import { type JwtUser } from '@bitcrm/types';
import { DealAttachmentsService } from 'src/deals/attachments/deal-attachments.service';

const caller: JwtUser = {
  id: 'disp-1',
  cognitoSub: 'sub',
  email: 'd@x.com',
  roleId: 'role-dispatcher',
  department: 'HQ',
};

const storedAttachment = {
  dealId: 'd1',
  id: 'att-1',
  fileName: 'before.jpg',
  contentType: 'image/jpeg',
  size: 2048,
  category: 'before',
  s3Key: 'deals/d1/attachments/att-1',
  uploadedBy: 'disp-1',
  uploadedAt: '2026-07-30T10:00:00.000Z',
};

describe('DealAttachmentsService', () => {
  let s3: {
    getPresignedUpload: jest.Mock;
    getPresignedDownloadUrl: jest.Mock;
    deleteObject: jest.Mock;
  };
  let repo: {
    create: jest.Mock;
    get: jest.Mock;
    listByDeal: jest.Mock;
    update: jest.Mock;
    delete: jest.Mock;
  };
  let service: DealAttachmentsService;

  beforeEach(() => {
    s3 = {
      getPresignedUpload: jest.fn().mockResolvedValue({
        url: 'https://s3/upload',
        headers: { 'Content-Type': 'image/jpeg' },
      }),
      getPresignedDownloadUrl: jest.fn().mockResolvedValue('https://s3/download'),
      deleteObject: jest.fn().mockResolvedValue(undefined),
    };
    repo = {
      create: jest.fn().mockResolvedValue(undefined),
      get: jest.fn().mockResolvedValue(storedAttachment),
      listByDeal: jest.fn().mockResolvedValue([]),
      update: jest.fn().mockResolvedValue(storedAttachment),
      delete: jest.fn().mockResolvedValue(undefined),
    };
    service = new DealAttachmentsService(s3 as never, repo as never);
  });

  describe('update', () => {
    it('renames the file and sets the description, returning meta without the s3 key', async () => {
      repo.update.mockResolvedValue({
        ...storedAttachment,
        fileName: 'front door.jpg',
        description: 'Broken latch, before repair',
      });

      const res = await service.update(
        'd1',
        'att-1',
        { fileName: 'front door.jpg', description: 'Broken latch, before repair' },
        caller,
      );

      expect(repo.update).toHaveBeenCalledWith('d1', 'att-1', {
        fileName: 'front door.jpg',
        description: 'Broken latch, before repair',
      });
      expect(res).toMatchObject({
        id: 'att-1',
        fileName: 'front door.jpg',
        description: 'Broken latch, before repair',
      });
      expect(res).not.toHaveProperty('s3Key');
      expect(res).not.toHaveProperty('dealId');
    });

    it('404s when the attachment does not exist', async () => {
      repo.get.mockResolvedValue(null);

      await expect(
        service.update('d1', 'missing', { fileName: 'x.jpg' }, caller),
      ).rejects.toThrow(NotFoundException);
      expect(repo.update).not.toHaveBeenCalled();
    });
  });

  describe('requestUpload', () => {
    it('presigns an upload keyed by a generated id and persists metadata', async () => {
      const res = await service.requestUpload(
        'd1',
        { fileName: 'before.jpg', contentType: 'image/jpeg', size: 2048, category: 'before' },
        caller,
      );

      expect(res.uploadUrl).toBe('https://s3/upload');
      expect(res.headers).toEqual({ 'Content-Type': 'image/jpeg' });
      expect(res.id).toBeTruthy();
      // The S3 key embeds the returned attachment id.
      expect(res.s3Key).toBe(`deals/d1/attachments/${res.id}`);
      expect(s3.getPresignedUpload).toHaveBeenCalledWith(
        `deals/d1/attachments/${res.id}`,
        expect.objectContaining({ contentType: 'image/jpeg' }),
      );
      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          dealId: 'd1',
          id: res.id,
          fileName: 'before.jpg',
          contentType: 'image/jpeg',
          size: 2048,
          category: 'before',
          s3Key: `deals/d1/attachments/${res.id}`,
          uploadedBy: 'disp-1',
        }),
      );
    });

    it('gives each upload a distinct id', async () => {
      const a = await service.requestUpload('d1', { fileName: 'a.jpg', contentType: 'image/jpeg' }, caller);
      const b = await service.requestUpload('d1', { fileName: 'b.jpg', contentType: 'image/jpeg' }, caller);
      expect(a.id).not.toBe(b.id);
    });
  });

  describe('getDownloadUrl', () => {
    it('returns a short-TTL presigned download URL for the stored key', async () => {
      const res = await service.getDownloadUrl('d1', 'att-1');
      expect(res.downloadUrl).toBe('https://s3/download');
      expect(s3.getPresignedDownloadUrl).toHaveBeenCalledWith('deals/d1/attachments/att-1', 300);
    });

    it('404s when the attachment is missing', async () => {
      repo.get.mockResolvedValue(null);
      await expect(service.getDownloadUrl('d1', 'nope')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('list', () => {
    it('returns metadata without leaking the S3 key, sorted by uploadedAt', async () => {
      repo.listByDeal.mockResolvedValue([
        { ...storedAttachment, id: 'att-2', uploadedAt: '2026-07-30T12:00:00.000Z' },
        { ...storedAttachment, id: 'att-1', uploadedAt: '2026-07-30T10:00:00.000Z' },
      ]);
      const res = await service.list('d1');
      expect(res.map((a) => a.id)).toEqual(['att-1', 'att-2']);
      expect(res[0]).not.toHaveProperty('s3Key');
      expect(res[0]).toMatchObject({
        id: 'att-1',
        fileName: 'before.jpg',
        contentType: 'image/jpeg',
        category: 'before',
      });
    });
  });

  describe('delete', () => {
    it('removes the S3 object and the metadata row', async () => {
      await service.delete('d1', 'att-1');
      expect(s3.deleteObject).toHaveBeenCalledWith('deals/d1/attachments/att-1');
      expect(repo.delete).toHaveBeenCalledWith('d1', 'att-1');
    });

    it('404s when the attachment is missing', async () => {
      repo.get.mockResolvedValue(null);
      await expect(service.delete('d1', 'nope')).rejects.toBeInstanceOf(NotFoundException);
      expect(s3.deleteObject).not.toHaveBeenCalled();
    });
  });
});
