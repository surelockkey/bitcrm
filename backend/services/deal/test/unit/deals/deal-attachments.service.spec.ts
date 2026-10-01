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
  let timeline: { addEntry: jest.Mock };
  let deals: { findById: jest.Mock };
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
    timeline = { addEntry: jest.fn().mockResolvedValue(undefined) };
    deals = { findById: jest.fn().mockResolvedValue({ id: 'd1', contactId: 'c1' }) };
    service = new DealAttachmentsService(s3 as never, repo as never, timeline as never, deals as never);
  });

  /**
   * A job's file is also the client's file: the row names the job's client so
   * GSI10 (the client card's Files) can list it, and so does every timeline
   * entry about it (the client card's History).
   */
  describe('the job’s client on the rows', () => {
    it('upload stamps the deal’s contactId on the attachment row and the timeline entry', async () => {
      const res = await service.requestUpload('d1', { fileName: 'a.jpg', contentType: 'image/jpeg' }, caller);
      expect(deals.findById).toHaveBeenCalledWith('d1');
      expect(repo.create).toHaveBeenCalledWith(expect.objectContaining({ id: res.id, dealId: 'd1', contactId: 'c1' }));
      expect(timeline.addEntry).toHaveBeenCalledWith(expect.objectContaining({ dealId: 'd1', contactId: 'c1' }));
    });

    it('upload on an unknown job is a 404, not an orphan row', async () => {
      deals.findById.mockRejectedValue(new NotFoundException('Deal nope not found'));
      await expect(
        service.requestUpload('nope', { fileName: 'a.jpg', contentType: 'image/jpeg' }, caller),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(repo.create).not.toHaveBeenCalled();
      expect(s3.getPresignedUpload).not.toHaveBeenCalled();
    });

    it('rename and delete file their entries under the client the row names, without re-reading the job', async () => {
      repo.get.mockResolvedValue({ ...storedAttachment, contactId: 'c1' });
      repo.update.mockResolvedValue({ ...storedAttachment, contactId: 'c1', fileName: 'x.jpg' });
      await service.update('d1', 'att-1', { fileName: 'x.jpg' }, caller);
      await service.delete('d1', 'att-1', caller);
      expect(timeline.addEntry.mock.calls.map((c) => c[0].contactId)).toEqual(['c1', 'c1']);
      expect(deals.findById).not.toHaveBeenCalled();
    });

    it('a row written before the index (no contactId) falls back to the job for its client', async () => {
      await service.delete('d1', 'att-1', caller);
      expect(deals.findById).toHaveBeenCalledWith('d1');
      expect(timeline.addEntry).toHaveBeenCalledWith(expect.objectContaining({ contactId: 'c1' }));
    });
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
      await service.delete('d1', 'att-1', caller);
      expect(s3.deleteObject).toHaveBeenCalledWith('deals/d1/attachments/att-1');
      expect(repo.delete).toHaveBeenCalledWith('d1', 'att-1');
    });

    it('404s when the attachment is missing', async () => {
      repo.get.mockResolvedValue(null);
      await expect(service.delete('d1', 'nope', caller)).rejects.toBeInstanceOf(NotFoundException);
      expect(s3.deleteObject).not.toHaveBeenCalled();
    });
  });

  /**
   * Attachments are part of what happened on a job — a photo appearing or
   * vanishing without a trace defeats the timeline's "who did what" promise.
   */
  describe('timeline logging', () => {
    it('logs an attachment_added entry on upload', async () => {
      const res = await service.requestUpload(
        'd1',
        { fileName: 'before.jpg', contentType: 'image/jpeg', size: 2048, category: 'before' },
        caller,
      );

      expect(timeline.addEntry).toHaveBeenCalledWith(
        expect.objectContaining({
          dealId: 'd1',
          eventType: 'attachment_added',
          actorId: 'disp-1',
          actorName: 'd@x.com',
          details: expect.objectContaining({
            attachmentId: res.id,
            fileName: 'before.jpg',
            category: 'before',
            size: 2048,
          }),
        }),
      );
    });

    it('logs a rename with both names, and a description edit', async () => {
      repo.update.mockResolvedValue({ ...storedAttachment, fileName: 'front door.jpg' });

      await service.update('d1', 'att-1', { fileName: 'front door.jpg' }, caller);

      expect(timeline.addEntry).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'attachment_renamed',
          details: expect.objectContaining({
            attachmentId: 'att-1',
            fileName: 'front door.jpg',
            previousFileName: 'before.jpg',
          }),
        }),
      );
    });

    it('does not log an update that changed nothing', async () => {
      repo.update.mockResolvedValue(storedAttachment);

      await service.update('d1', 'att-1', { fileName: 'before.jpg' }, caller);

      expect(timeline.addEntry).not.toHaveBeenCalled();
    });

    it('logs an attachment_removed entry naming the file', async () => {
      await service.delete('d1', 'att-1', caller);

      expect(timeline.addEntry).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'attachment_removed',
          actorId: 'disp-1',
          details: expect.objectContaining({
            attachmentId: 'att-1',
            fileName: 'before.jpg',
            category: 'before',
          }),
        }),
      );
    });

    it('a timeline write failure does not fail the upload itself', async () => {
      timeline.addEntry.mockRejectedValue(new Error('dynamo down'));

      const res = await service.requestUpload(
        'd1',
        { fileName: 'before.jpg', contentType: 'image/jpeg' },
        caller,
      );

      expect(res.uploadUrl).toBe('https://s3/upload');
      expect(repo.create).toHaveBeenCalled();
    });
  });
});
