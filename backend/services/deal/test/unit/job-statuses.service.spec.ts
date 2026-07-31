import { ConflictException, NotFoundException } from '@nestjs/common';
import { DealStageGroup, type DealSubStatus } from '@bitcrm/types';
import { JobStatusesService } from '../../src/job-statuses/job-statuses.service';
import { JobStatusesRepository } from '../../src/job-statuses/job-statuses.repository';

/**
 * In-memory stand-in for the DynamoDB-backed repository, so the service's rules
 * (defaults, name uniqueness within a super-status, archive-vs-delete) can be
 * exercised without a database.
 */
class FakeRepo {
  store = new Map<string, DealSubStatus>();
  references = new Set<string>();

  async create(s: DealSubStatus) {
    this.store.set(s.id, s);
  }
  async put(s: DealSubStatus) {
    this.store.set(s.id, s);
  }
  async get(id: string) {
    return this.store.get(id) ?? null;
  }
  async listAll() {
    return [...this.store.values()];
  }
  async remove(id: string) {
    this.store.delete(id);
  }
  async isReferencedByDeal(id: string) {
    return this.references.has(id);
  }
}

const caller = { id: 'admin-1' } as any;

function makeService() {
  const repo = new FakeRepo();
  const service = new JobStatusesService(repo as unknown as JobStatusesRepository);
  return { service, repo };
}

describe('JobStatusesService', () => {
  describe('create', () => {
    it('fills defaults (slate, priority 0, active) and stamps audit fields', async () => {
      const { service } = makeService();
      const created = await service.create(
        { name: 'Will Call Back', group: DealStageGroup.PENDING },
        caller,
      );

      expect(created).toMatchObject({
        name: 'Will Call Back',
        group: DealStageGroup.PENDING,
        color: 'slate',
        priority: 0,
        active: true,
        createdBy: 'admin-1',
      });
      expect(created.id).toBeTruthy();
      expect(created.createdAt).toBeTruthy();
      expect(created.updatedAt).toBe(created.createdAt);
    });

    it('honors explicit color and priority', async () => {
      const { service } = makeService();
      const created = await service.create(
        { name: 'Job Done', group: DealStageGroup.IN_PROGRESS, color: 'green', priority: 10 },
        caller,
      );
      expect(created).toMatchObject({ color: 'green', priority: 10 });
    });

    it('rejects a duplicate name within the same super-status (case-insensitive)', async () => {
      const { service } = makeService();
      await service.create({ name: 'Job Done', group: DealStageGroup.IN_PROGRESS }, caller);
      await expect(
        service.create({ name: ' job done ', group: DealStageGroup.IN_PROGRESS }, caller),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('allows the same name under a different super-status', async () => {
      const { service } = makeService();
      await service.create({ name: 'In progress', group: DealStageGroup.SUBMITTED }, caller);
      await expect(
        service.create({ name: 'In progress', group: DealStageGroup.IN_PROGRESS }, caller),
      ).resolves.toMatchObject({ name: 'In progress', group: DealStageGroup.IN_PROGRESS });
    });
  });

  describe('list', () => {
    it('sorts by priority desc then name asc', async () => {
      const { service } = makeService();
      await service.create({ name: 'B', group: DealStageGroup.PENDING, priority: 1 }, caller);
      await service.create({ name: 'A', group: DealStageGroup.PENDING, priority: 5 }, caller);
      await service.create({ name: 'Z', group: DealStageGroup.PENDING, priority: 5 }, caller);

      const list = await service.list();
      expect(list.map((s) => s.name)).toEqual(['A', 'Z', 'B']);
    });
  });

  describe('findById', () => {
    it('throws NotFound for an unknown id', async () => {
      const { service } = makeService();
      await expect(service.findById('nope')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('update', () => {
    it('renames and re-stamps updatedAt', async () => {
      const { service } = makeService();
      const s = await service.create({ name: 'Old', group: DealStageGroup.PENDING }, caller);
      const updated = await service.update(s.id, { name: 'New' }, caller);
      expect(updated.name).toBe('New');
    });

    it('rejects renaming onto a sibling name in the same group', async () => {
      const { service } = makeService();
      await service.create({ name: 'Job Done', group: DealStageGroup.IN_PROGRESS }, caller);
      const other = await service.create(
        { name: 'Job Accepted', group: DealStageGroup.IN_PROGRESS },
        caller,
      );
      await expect(
        service.update(other.id, { name: 'Job Done' }, caller),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('archives via active:false without a name clash', async () => {
      const { service } = makeService();
      const s = await service.create({ name: 'Job Done', group: DealStageGroup.IN_PROGRESS }, caller);
      const updated = await service.update(s.id, { active: false }, caller);
      expect(updated.active).toBe(false);
    });
  });

  describe('remove', () => {
    it('deletes a status no deal references', async () => {
      const { service, repo } = makeService();
      const s = await service.create({ name: 'Job Done', group: DealStageGroup.IN_PROGRESS }, caller);
      const res = await service.remove(s.id, caller);
      expect(res).toEqual({ archived: false });
      expect(await repo.get(s.id)).toBeNull();
    });

    it('archives a status still referenced by a deal', async () => {
      const { service, repo } = makeService();
      const s = await service.create({ name: 'Job Done', group: DealStageGroup.IN_PROGRESS }, caller);
      repo.references.add(s.id);
      const res = await service.remove(s.id, caller);
      expect(res).toEqual({ archived: true });
      expect((await repo.get(s.id))?.active).toBe(false);
    });
  });
});
