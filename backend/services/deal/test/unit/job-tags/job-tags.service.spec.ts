import { ConflictException, NotFoundException } from '@nestjs/common';
import { JobTagsService } from 'src/job-tags/job-tags.service';
import {
  createMockJobTagsRepository,
  createMockSnsPublisherService,
  createMockJobTag,
  createMockJwtUser,
} from '../mocks';

describe('JobTagsService', () => {
  let repo: ReturnType<typeof createMockJobTagsRepository>;
  let sns: ReturnType<typeof createMockSnsPublisherService>;
  let service: JobTagsService;
  const caller = createMockJwtUser();

  beforeEach(() => {
    repo = createMockJobTagsRepository();
    sns = createMockSnsPublisherService();
    service = new JobTagsService(repo as any, sns as any);
  });

  describe('create', () => {
    it('persists a new job tag and emits an event', async () => {
      const jobTag = await service.create({ name: 'Rush', priority: 5, color: 'red' } as any, caller);

      expect(jobTag).toMatchObject({ name: 'Rush', priority: 5, active: true, color: 'red' });
      expect(jobTag.id).toBeDefined();
      expect(repo.create).toHaveBeenCalledWith(expect.objectContaining({ color: 'red' }));
      expect(repo.create).toHaveBeenCalledWith(expect.objectContaining({ name: 'Rush' }));
      expect(sns.publish).toHaveBeenCalledWith('deal-events', 'job-tag.created', expect.any(Object));
    });

    it('rejects a duplicate name (case-insensitive) with 409', async () => {
      repo.listAll.mockResolvedValue([createMockJobTag({ name: 'Repeat' })]);
      await expect(service.create({ name: '  repeat ' } as any, caller)).rejects.toThrow(ConflictException);
      expect(repo.create).not.toHaveBeenCalled();
    });
  });

  describe('update', () => {
    it('re-checks name uniqueness when renaming', async () => {
      repo.get.mockResolvedValue(createMockJobTag({ id: 'jt-1', name: 'Rush' }));
      repo.listAll.mockResolvedValue([
        createMockJobTag({ id: 'jt-1', name: 'Rush' }),
        createMockJobTag({ id: 'jt-2', name: 'Repeat' }),
      ]);
      await expect(service.update('jt-1', { name: 'Repeat' } as any, caller)).rejects.toThrow(ConflictException);
    });

    it('allows keeping the same name', async () => {
      repo.get.mockResolvedValue(createMockJobTag({ id: 'jt-1', name: 'Rush' }));
      repo.listAll.mockResolvedValue([createMockJobTag({ id: 'jt-1', name: 'Rush' })]);
      const updated = await service.update('jt-1', { name: 'Rush', priority: 9 } as any, caller);
      expect(updated.priority).toBe(9);
      expect(repo.put).toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    it('archives a referenced job tag instead of deleting it', async () => {
      repo.get.mockResolvedValue(createMockJobTag({ id: 'jt-1', active: true }));
      repo.isReferencedByDeal.mockResolvedValue(true);

      const result = await service.remove('jt-1', caller);

      expect(result).toEqual({ archived: true });
      expect(repo.remove).not.toHaveBeenCalled();
      expect(repo.put).toHaveBeenCalledWith(expect.objectContaining({ active: false }));
      expect(sns.publish).toHaveBeenCalledWith('deal-events', 'job-tag.archived', expect.any(Object));
    });

    it('hard-deletes an unreferenced job tag', async () => {
      repo.get.mockResolvedValue(createMockJobTag({ id: 'jt-1' }));
      repo.isReferencedByDeal.mockResolvedValue(false);

      const result = await service.remove('jt-1', caller);

      expect(result).toEqual({ archived: false });
      expect(repo.remove).toHaveBeenCalledWith('jt-1');
      expect(sns.publish).toHaveBeenCalledWith('deal-events', 'job-tag.deleted', expect.any(Object));
    });

    it('404s when the job tag is missing', async () => {
      repo.get.mockResolvedValue(null);
      await expect(service.remove('missing', caller)).rejects.toThrow(NotFoundException);
    });
  });

  describe('list', () => {
    it('sorts by priority desc, then name asc', async () => {
      repo.listAll.mockResolvedValue([
        createMockJobTag({ name: 'B', priority: 1 }),
        createMockJobTag({ name: 'A', priority: 5 }),
        createMockJobTag({ name: 'A2', priority: 5 }),
      ]);
      const list = await service.list();
      expect(list.map((j) => j.name)).toEqual(['A', 'A2', 'B']);
    });
  });
});
