import { ConflictException, NotFoundException } from '@nestjs/common';
import { JobSourcesService } from 'src/job-sources/job-sources.service';
import {
  createMockJobSourcesRepository,
  createMockSnsPublisherService,
  createMockJobSource,
  createMockJwtUser,
} from '../mocks';

describe('JobSourcesService', () => {
  let repo: ReturnType<typeof createMockJobSourcesRepository>;
  let sns: ReturnType<typeof createMockSnsPublisherService>;
  let service: JobSourcesService;
  const caller = createMockJwtUser();

  beforeEach(() => {
    repo = createMockJobSourcesRepository();
    sns = createMockSnsPublisherService();
    service = new JobSourcesService(repo as any, sns as any);
  });

  describe('create', () => {
    it('persists a new job source and emits an event', async () => {
      const jobSource = await service.create({ name: 'Google Ads', priority: 5 } as any, caller);

      expect(jobSource).toMatchObject({ name: 'Google Ads', priority: 5, active: true });
      expect(jobSource.id).toBeDefined();
      expect(repo.create).toHaveBeenCalledWith(expect.objectContaining({ name: 'Google Ads' }));
      expect(sns.publish).toHaveBeenCalledWith('deal-events', 'job-source.created', expect.any(Object));
    });

    it('rejects a duplicate name (case-insensitive) with 409', async () => {
      repo.listAll.mockResolvedValue([createMockJobSource({ name: 'Referral' })]);
      await expect(service.create({ name: '  referral ' } as any, caller)).rejects.toThrow(ConflictException);
      expect(repo.create).not.toHaveBeenCalled();
    });
  });

  describe('update', () => {
    it('re-checks name uniqueness when renaming', async () => {
      repo.get.mockResolvedValue(createMockJobSource({ id: 'jt-1', name: 'Google Ads' }));
      repo.listAll.mockResolvedValue([
        createMockJobSource({ id: 'jt-1', name: 'Google Ads' }),
        createMockJobSource({ id: 'jt-2', name: 'Referral' }),
      ]);
      await expect(service.update('jt-1', { name: 'Referral' } as any, caller)).rejects.toThrow(ConflictException);
    });

    it('allows keeping the same name', async () => {
      repo.get.mockResolvedValue(createMockJobSource({ id: 'jt-1', name: 'Google Ads' }));
      repo.listAll.mockResolvedValue([createMockJobSource({ id: 'jt-1', name: 'Google Ads' })]);
      const updated = await service.update('jt-1', { name: 'Google Ads', priority: 9 } as any, caller);
      expect(updated.priority).toBe(9);
      expect(repo.put).toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    it('archives a referenced job source instead of deleting it', async () => {
      repo.get.mockResolvedValue(createMockJobSource({ id: 'jt-1', active: true }));
      repo.isReferencedByDeal.mockResolvedValue(true);

      const result = await service.remove('jt-1', caller);

      expect(result).toEqual({ archived: true });
      expect(repo.remove).not.toHaveBeenCalled();
      expect(repo.put).toHaveBeenCalledWith(expect.objectContaining({ active: false }));
      expect(sns.publish).toHaveBeenCalledWith('deal-events', 'job-source.archived', expect.any(Object));
    });

    it('hard-deletes an unreferenced job source', async () => {
      repo.get.mockResolvedValue(createMockJobSource({ id: 'jt-1' }));
      repo.isReferencedByDeal.mockResolvedValue(false);

      const result = await service.remove('jt-1', caller);

      expect(result).toEqual({ archived: false });
      expect(repo.remove).toHaveBeenCalledWith('jt-1');
      expect(sns.publish).toHaveBeenCalledWith('deal-events', 'job-source.deleted', expect.any(Object));
    });

    it('404s when the job source is missing', async () => {
      repo.get.mockResolvedValue(null);
      await expect(service.remove('missing', caller)).rejects.toThrow(NotFoundException);
    });
  });

  describe('list', () => {
    it('sorts by priority desc, then name asc', async () => {
      repo.listAll.mockResolvedValue([
        createMockJobSource({ name: 'B', priority: 1 }),
        createMockJobSource({ name: 'A', priority: 5 }),
        createMockJobSource({ name: 'A2', priority: 5 }),
      ]);
      const list = await service.list();
      expect(list.map((j) => j.name)).toEqual(['A', 'A2', 'B']);
    });
  });
});
