import { ConflictException, NotFoundException } from '@nestjs/common';
import { ClientTagsService } from 'src/client-tags/client-tags.service';
import {
  createMockClientTagsRepository,
  createMockSnsPublisherService,
  createMockClientTag,
  createMockJwtUser,
} from '../mocks';

describe('ClientTagsService', () => {
  let repo: ReturnType<typeof createMockClientTagsRepository>;
  let sns: ReturnType<typeof createMockSnsPublisherService>;
  let service: ClientTagsService;
  const caller = createMockJwtUser();

  beforeEach(() => {
    repo = createMockClientTagsRepository();
    sns = createMockSnsPublisherService();
    service = new ClientTagsService(repo as any, sns as any);
  });

  describe('create', () => {
    it('persists a new client tag and emits an event', async () => {
      const clientTag = await service.create({ name: 'Rush', priority: 5, color: 'red' } as any, caller);

      expect(clientTag).toMatchObject({ name: 'Rush', priority: 5, active: true, color: 'red' });
      expect(clientTag.id).toBeDefined();
      expect(repo.create).toHaveBeenCalledWith(expect.objectContaining({ color: 'red' }));
      expect(repo.create).toHaveBeenCalledWith(expect.objectContaining({ name: 'Rush' }));
      expect(sns.publish).toHaveBeenCalledWith('deal-events', 'client-tag.created', expect.any(Object));
    });

    it('rejects a duplicate name (case-insensitive) with 409', async () => {
      repo.listAll.mockResolvedValue([createMockClientTag({ name: 'Repeat' })]);
      await expect(service.create({ name: '  repeat ' } as any, caller)).rejects.toThrow(ConflictException);
      expect(repo.create).not.toHaveBeenCalled();
    });
  });

  describe('update', () => {
    it('re-checks name uniqueness when renaming', async () => {
      repo.get.mockResolvedValue(createMockClientTag({ id: 'jt-1', name: 'Rush' }));
      repo.listAll.mockResolvedValue([
        createMockClientTag({ id: 'jt-1', name: 'Rush' }),
        createMockClientTag({ id: 'jt-2', name: 'Repeat' }),
      ]);
      await expect(service.update('jt-1', { name: 'Repeat' } as any, caller)).rejects.toThrow(ConflictException);
    });

    it('allows keeping the same name', async () => {
      repo.get.mockResolvedValue(createMockClientTag({ id: 'jt-1', name: 'Rush' }));
      repo.listAll.mockResolvedValue([createMockClientTag({ id: 'jt-1', name: 'Rush' })]);
      const updated = await service.update('jt-1', { name: 'Rush', priority: 9 } as any, caller);
      expect(updated.priority).toBe(9);
      expect(repo.put).toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    it('archives the client tag — never deletes: its clients live in a table this service cannot scan', async () => {
      repo.get.mockResolvedValue(createMockClientTag({ id: 'jt-1' }));

      const result = await service.remove('jt-1', caller);

      expect(result).toEqual({ archived: true });
      expect(repo.remove).not.toHaveBeenCalled();
      expect(repo.put).toHaveBeenCalledWith(expect.objectContaining({ id: 'jt-1', active: false }));
      expect(sns.publish).toHaveBeenCalledWith('deal-events', 'client-tag.archived', expect.any(Object));
    });

    it('leaves an already archived tag as it is', async () => {
      repo.get.mockResolvedValue(createMockClientTag({ id: 'jt-1', active: false }));

      await service.remove('jt-1', caller);

      expect(repo.put).not.toHaveBeenCalled();
    });

    it('throws NotFound for an unknown tag', async () => {
      repo.get.mockResolvedValue(null);
      await expect(service.remove('missing', caller)).rejects.toThrow(NotFoundException);
    });
  });

  describe('list', () => {
    it('sorts by priority desc, then name asc', async () => {
      repo.listAll.mockResolvedValue([
        createMockClientTag({ name: 'B', priority: 1 }),
        createMockClientTag({ name: 'A', priority: 5 }),
        createMockClientTag({ name: 'A2', priority: 5 }),
      ]);
      const list = await service.list();
      expect(list.map((j) => j.name)).toEqual(['A', 'A2', 'B']);
    });
  });
});
