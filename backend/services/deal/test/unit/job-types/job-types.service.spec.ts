import { ConflictException, NotFoundException } from '@nestjs/common';
import { JobTypesService } from 'src/job-types/job-types.service';
import {
  createMockJobTypesRepository,
  createMockSnsPublisherService,
  createMockJobType,
  createMockJwtUser,
} from '../mocks';

describe('JobTypesService', () => {
  let repo: ReturnType<typeof createMockJobTypesRepository>;
  let sns: ReturnType<typeof createMockSnsPublisherService>;
  let service: JobTypesService;
  const caller = createMockJwtUser();

  beforeEach(() => {
    repo = createMockJobTypesRepository();
    sns = createMockSnsPublisherService();
    service = new JobTypesService(repo as any, sns as any);
  });

  describe('create', () => {
    it('persists a new job type and emits an event', async () => {
      const jobType = await service.create({ name: 'Lockout', priority: 5 } as any, caller);

      expect(jobType).toMatchObject({ name: 'Lockout', priority: 5, active: true });
      expect(jobType.id).toBeDefined();
      expect(repo.create).toHaveBeenCalledWith(expect.objectContaining({ name: 'Lockout' }));
      expect(sns.publish).toHaveBeenCalledWith('deal-events', 'job-type.created', expect.any(Object));
    });

    it('rejects a duplicate name (case-insensitive) with 409', async () => {
      repo.listAll.mockResolvedValue([createMockJobType({ name: 'Rekey' })]);
      await expect(service.create({ name: '  rekey ' } as any, caller)).rejects.toThrow(ConflictException);
      expect(repo.create).not.toHaveBeenCalled();
    });
  });

  describe('update', () => {
    it('re-checks name uniqueness when renaming', async () => {
      repo.get.mockResolvedValue(createMockJobType({ id: 'jt-1', name: 'Lockout' }));
      repo.listAll.mockResolvedValue([
        createMockJobType({ id: 'jt-1', name: 'Lockout' }),
        createMockJobType({ id: 'jt-2', name: 'Rekey' }),
      ]);
      await expect(service.update('jt-1', { name: 'Rekey' } as any, caller)).rejects.toThrow(ConflictException);
    });

    it('allows keeping the same name', async () => {
      repo.get.mockResolvedValue(createMockJobType({ id: 'jt-1', name: 'Lockout' }));
      repo.listAll.mockResolvedValue([createMockJobType({ id: 'jt-1', name: 'Lockout' })]);
      const updated = await service.update('jt-1', { name: 'Lockout', priority: 9 } as any, caller);
      expect(updated.priority).toBe(9);
      expect(repo.put).toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    it('archives a referenced job type instead of deleting it', async () => {
      repo.get.mockResolvedValue(createMockJobType({ id: 'jt-1', active: true }));
      repo.isReferencedByDeal.mockResolvedValue(true);

      const result = await service.remove('jt-1', caller);

      expect(result).toEqual({ archived: true });
      expect(repo.remove).not.toHaveBeenCalled();
      expect(repo.put).toHaveBeenCalledWith(expect.objectContaining({ active: false }));
      expect(sns.publish).toHaveBeenCalledWith('deal-events', 'job-type.archived', expect.any(Object));
    });

    it('hard-deletes an unreferenced job type', async () => {
      repo.get.mockResolvedValue(createMockJobType({ id: 'jt-1' }));
      repo.isReferencedByDeal.mockResolvedValue(false);

      const result = await service.remove('jt-1', caller);

      expect(result).toEqual({ archived: false });
      expect(repo.remove).toHaveBeenCalledWith('jt-1');
      expect(sns.publish).toHaveBeenCalledWith('deal-events', 'job-type.deleted', expect.any(Object));
    });

    it('404s when the job type is missing', async () => {
      repo.get.mockResolvedValue(null);
      await expect(service.remove('missing', caller)).rejects.toThrow(NotFoundException);
    });
  });

  describe('list', () => {
    it('sorts by priority desc, then name asc', async () => {
      repo.listAll.mockResolvedValue([
        createMockJobType({ name: 'B', priority: 1 }),
        createMockJobType({ name: 'A', priority: 5 }),
        createMockJobType({ name: 'A2', priority: 5 }),
      ]);
      const list = await service.list();
      expect(list.map((j) => j.name)).toEqual(['A', 'A2', 'B']);
    });
  });
});
