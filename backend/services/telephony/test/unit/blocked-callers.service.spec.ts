import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import type { BlockedCaller } from '@bitcrm/types';
import { BlockedCallersService, BLOCKED_CACHE_TTL_MS } from '../../src/blocked-callers/blocked-callers.service';

/**
 * Workiz Phone → Blocked callers: "Define numbers you wish to block like sales
 * calls and other spam callers." A number on the list is rejected on every
 * inbound call and text. Rules under test: numbers are stored as E.164 whatever
 * way they were typed, a number is blocked once, the list reads oldest first
 * and pages, and the inbound check is cheap and never throws.
 */
function build(seed: BlockedCaller[] = []) {
  const store = new Map(seed.map((r) => [r.number, structuredClone(r)]));
  const repository = {
    listAll: jest.fn(async () => [...store.values()]),
    get: jest.fn(async (number: string) => store.get(number) ?? null),
    create: jest.fn(async (r: BlockedCaller) => {
      if (store.has(r.number)) {
        const err = new Error('The conditional request failed');
        err.name = 'ConditionalCheckFailedException';
        throw err;
      }
      store.set(r.number, r);
    }),
    remove: jest.fn(async (number: string) => store.delete(number)),
  };
  const service = new BlockedCallersService(repository as never);
  return { service, repository, store };
}

const caller = { id: 'u-dispatcher' };

const row = (over: Partial<BlockedCaller> = {}): BlockedCaller => ({
  id: 'b1',
  number: '+12147917112',
  comment: 'spam',
  createdBy: 'u-admin',
  createdAt: '2022-11-08T14:21:52.000Z',
  ...over,
});

describe('BlockedCallersService', () => {
  describe('block', () => {
    it('stores the number as E.164 with a trimmed comment and the caller', async () => {
      const { service, store } = build();

      const created = await service.block({ number: '(214) 791-7112', comment: '  sales calls  ' }, caller);

      expect(created).toMatchObject({ number: '+12147917112', comment: 'sales calls', createdBy: 'u-dispatcher' });
      expect(created.id).toMatch(/^[0-9a-f-]{36}$/);
      expect(created.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(store.get('+12147917112')).toEqual(created);
    });

    it('keeps an empty comment absent, not ""', async () => {
      const { service } = build();
      const created = await service.block({ number: '2147917112', comment: '' }, caller);
      expect(created.comment).toBeUndefined();
      expect(Object.keys(created)).not.toContain('comment');
    });

    it('refuses a number that is not dialable', async () => {
      const { service, repository } = build();
      await expect(service.block({ number: '' }, caller)).rejects.toBeInstanceOf(BadRequestException);
      await expect(service.block({ number: 'spam' }, caller)).rejects.toBeInstanceOf(BadRequestException);
      await expect(service.block({ number: '123' }, caller)).rejects.toBeInstanceOf(BadRequestException);
      expect(repository.create).not.toHaveBeenCalled();
    });

    it('refuses a comment past the limit', async () => {
      const { service } = build();
      await expect(service.block({ number: '2147917112', comment: 'x'.repeat(501) }, caller)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('is a conflict when the number is already blocked', async () => {
      const { service } = build([row()]);
      await expect(service.block({ number: '214-791-7112' }, caller)).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('unblock', () => {
    it('removes the row for the number in any written form', async () => {
      const { service, store } = build([row()]);
      expect(await service.unblock('(214) 791-7112', caller)).toEqual({ number: '+12147917112', deleted: true });
      expect(store.has('+12147917112')).toBe(false);
    });

    it('is a 404 for a number that is not blocked', async () => {
      const { service } = build();
      await expect(service.unblock('+12147917112', caller)).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('list', () => {
    const rows = [
      row({ id: 'b3', number: '+18602889619', createdAt: '2022-11-07T23:48:08.000Z', comment: undefined }),
      row({ id: 'b1', number: '+12147917112', createdAt: '2020-07-29T20:50:18.000Z', comment: "he doesn't want to pay" }),
      row({ id: 'b2', number: '+12037601092', createdAt: '2021-07-21T14:06:59.000Z', comment: undefined }),
    ];

    it('reads oldest first, in pages, with the count', async () => {
      const { service } = build(rows);
      const page1 = await service.list({ page: 1, limit: 2 });
      expect(page1.data.map((r) => r.id)).toEqual(['b1', 'b2']);
      expect(page1.pagination).toEqual({ total: 3, page: 1, limit: 2, pages: 2 });
      const page2 = await service.list({ page: 2, limit: 2 });
      expect(page2.data.map((r) => r.id)).toEqual(['b3']);
    });

    it('finds a number by its digits and a comment by its words', async () => {
      const { service } = build(rows);
      expect((await service.list({ q: '791-71' })).data.map((r) => r.id)).toEqual(['b1']);
      expect((await service.list({ q: '(203)' })).data.map((r) => r.id)).toEqual(['b2']);
      expect((await service.list({ q: 'WANT TO PAY' })).data.map((r) => r.id)).toEqual(['b1']);
      expect((await service.list({ q: 'nobody' })).data).toEqual([]);
    });

    it('clamps a wild page size and a page past the end', async () => {
      const { service } = build(rows);
      expect((await service.list({ limit: 99_999 })).pagination.limit).toBe(1000);
      expect((await service.list({ limit: 0 })).pagination.limit).toBe(50);
      expect((await service.list({ page: 9 })).pagination.page).toBe(1);
      expect((await service.list({ page: 9 })).data).toHaveLength(3);
    });
  });

  describe('isBlocked — the inbound check', () => {
    it('matches the caller in any written form, and only a blocked one', async () => {
      const { service } = build([row()]);
      expect(await service.isBlocked('+12147917112')).toBe(true);
      expect(await service.isBlocked('12147917112')).toBe(true);
      expect(await service.isBlocked('(214) 791-7112')).toBe(true);
      expect(await service.isBlocked('+15550000000')).toBe(false);
    });

    it('never calls our own softphone legs or an empty From blocked', async () => {
      const { service, repository } = build([row()]);
      expect(await service.isBlocked('client:agent-1')).toBe(false);
      expect(await service.isBlocked('')).toBe(false);
      expect(await service.isBlocked(undefined)).toBe(false);
      expect(repository.listAll).not.toHaveBeenCalled();
    });

    it('reads the list once per TTL — not once per call', async () => {
      const { service, repository } = build([row()]);
      await service.isBlocked('+12147917112', 1_000);
      await service.isBlocked('+15550000000', 1_000 + BLOCKED_CACHE_TTL_MS - 1);
      expect(repository.listAll).toHaveBeenCalledTimes(1);
      await service.isBlocked('+15550000000', 1_000 + BLOCKED_CACHE_TTL_MS + 1);
      expect(repository.listAll).toHaveBeenCalledTimes(2);
    });

    it('sees a number blocked or unblocked on this task at once', async () => {
      const { service } = build();
      expect(await service.isBlocked('+12147917112')).toBe(false);
      await service.block({ number: '+12147917112' }, caller);
      expect(await service.isBlocked('+12147917112')).toBe(true);
      await service.unblock('+12147917112', caller);
      expect(await service.isBlocked('+12147917112')).toBe(false);
    });

    it('fails open: a table that does not answer blocks nobody and throws at nobody', async () => {
      const { service, repository } = build();
      repository.listAll.mockRejectedValueOnce(new Error('ProvisionedThroughputExceededException'));
      await expect(service.isBlocked('+12147917112')).resolves.toBe(false);
    });

    it('keeps the last good list while the table is down', async () => {
      const { service, repository } = build([row()]);
      expect(await service.isBlocked('+12147917112', 0)).toBe(true);
      repository.listAll.mockRejectedValueOnce(new Error('down'));
      expect(await service.isBlocked('+12147917112', BLOCKED_CACHE_TTL_MS + 1)).toBe(true);
    });
  });

  it('hands messaging the E.164 numbers', async () => {
    const { service } = build([row(), row({ id: 'b2', number: '+12037601092' })]);
    expect((await service.numbers()).sort()).toEqual(['+12037601092', '+12147917112']);
  });
});
