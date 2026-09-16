import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import type { CallTag } from '@bitcrm/types';
import { CallTagsService } from '../../src/call-tags/call-tags.service';

/**
 * The call-tag catalog: the Workiz "call tags" (type 3) — SPAM CALLER, Tech
 * Call, WRONG NUMBER… Rules under test: names are unique, colors come from the
 * shared palette, and removal is an archive, never a delete.
 */
function build(seed: CallTag[] = []) {
  const store = new Map(seed.map((t) => [t.id, structuredClone(t)]));
  const repository = {
    listAll: jest.fn(async () => [...store.values()]),
    get: jest.fn(async (id: string) => store.get(id) ?? null),
    create: jest.fn(async (t: CallTag) => void store.set(t.id, t)),
    put: jest.fn(async (t: CallTag) => void store.set(t.id, t)),
  };
  const service = new CallTagsService(repository as never);
  return { service, repository, store };
}

const caller = { id: 'u-admin' };

const tag = (over: Partial<CallTag> = {}): CallTag => ({
  id: 't1',
  name: 'SPAM CALLER',
  color: 'red',
  priority: 0,
  active: true,
  createdBy: 'u-admin',
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-01T00:00:00.000Z',
  ...over,
});

describe('CallTagsService', () => {
  describe('create', () => {
    it('stores a trimmed name with palette defaults and the caller', async () => {
      const { service, store } = build();

      const created = await service.create({ name: '  Tech Call ' }, caller);

      expect(created).toMatchObject({
        name: 'Tech Call',
        color: 'slate',
        priority: 0,
        active: true,
        createdBy: 'u-admin',
      });
      expect(created.externalId).toBeUndefined();
      expect(store.get(created.id)).toEqual(created);
    });

    it('keeps the import provenance when given one', async () => {
      const { service } = build();
      const created = await service.create(
        { name: 'SPAM CALLER', color: 'blue', externalId: 'workiz:tag:645312' },
        caller,
      );
      expect(created.externalId).toBe('workiz:tag:645312');
      expect(created.color).toBe('blue');
    });

    it('refuses a second tag with the same name, whatever the casing', async () => {
      const { service } = build([tag()]);
      await expect(
        service.create({ name: ' spam caller ' }, caller),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('refuses an empty name — the DTO decorators do not run in this service', async () => {
      const { service } = build();
      await expect(service.create({ name: '   ' }, caller)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      await expect(
        service.create({} as never, caller),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('refuses a color outside the shared palette', async () => {
      const { service } = build();
      await expect(
        service.create({ name: 'BBB', color: '#e18a2b' as never }, caller),
      ).rejects.toThrow(/color must be one of/);
    });

    it('refuses a non-integer priority', async () => {
      const { service } = build();
      await expect(
        service.create({ name: 'BBB', priority: 1.5 }, caller),
      ).rejects.toThrow(/priority must be an integer/);
    });
  });

  describe('list', () => {
    it('sorts priority-first then by name, archived included', async () => {
      const { service } = build([
        tag({ id: 'a', name: 'Zeta', priority: 0 }),
        tag({ id: 'b', name: 'alpha', priority: 0, active: false }),
        tag({ id: 'c', name: 'Top', priority: 10 }),
      ]);

      const names = (await service.list()).map((t) => t.name);
      expect(names).toEqual(['Top', 'alpha', 'Zeta']);
    });
  });

  describe('update', () => {
    it('renames, recolors and stamps who did it', async () => {
      const { service, store } = build([tag()]);

      const updated = await service.update(
        't1',
        { name: 'Spam', color: 'amber', priority: 5 },
        { id: 'u-dana' },
      );

      expect(updated).toMatchObject({
        name: 'Spam',
        color: 'amber',
        priority: 5,
        updatedBy: 'u-dana',
      });
      expect(store.get('t1')!.name).toBe('Spam');
    });

    it('re-checks the name against every other tag', async () => {
      const { service } = build([tag(), tag({ id: 't2', name: 'Tech Call' })]);
      await expect(
        service.update('t2', { name: 'spam caller' }, caller),
      ).rejects.toBeInstanceOf(ConflictException);
      // Renaming to its own name (different casing) is fine.
      await expect(
        service.update('t2', { name: 'TECH CALL' }, caller),
      ).resolves.toMatchObject({ name: 'TECH CALL' });
    });

    it('restores an archived tag with active: true', async () => {
      const { service } = build([tag({ active: false })]);
      const restored = await service.update('t1', { active: true }, caller);
      expect(restored.active).toBe(true);
    });

    it('404s for a tag that does not exist', async () => {
      const { service } = build();
      await expect(
        service.update('nope', { name: 'x' }, caller),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('archive', () => {
    it('flips active off and keeps the row — calls still resolve the name', async () => {
      const { service, repository, store } = build([tag()]);

      const archived = await service.archive('t1', { id: 'u-dana' });

      expect(archived.active).toBe(false);
      expect(archived.updatedBy).toBe('u-dana');
      expect(store.has('t1')).toBe(true);
      expect(repository.put).toHaveBeenCalledTimes(1);
    });

    it('is idempotent on an already-archived tag', async () => {
      const { service, repository } = build([tag({ active: false })]);
      await service.archive('t1', caller);
      expect(repository.put).not.toHaveBeenCalled();
    });

    it('404s for an unknown tag', async () => {
      const { service } = build();
      await expect(service.archive('nope', caller)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('byId (the tagging hot path)', () => {
    it('memoises the catalog briefly and drops it on a write', async () => {
      const { service, repository } = build([tag()]);

      await service.byId();
      await service.byId();
      expect(repository.listAll).toHaveBeenCalledTimes(1);

      await service.create({ name: 'Tech Call' }, caller);
      // create() itself lists for the uniqueness check; the next byId() must
      // still hit the repository rather than serve the pre-create snapshot.
      const before = (repository.listAll as jest.Mock).mock.calls.length;
      const map = await service.byId();
      expect((repository.listAll as jest.Mock).mock.calls.length).toBe(before + 1);
      expect([...map.values()].map((t) => t.name)).toEqual(
        expect.arrayContaining(['SPAM CALLER', 'Tech Call']),
      );
    });
  });
});
