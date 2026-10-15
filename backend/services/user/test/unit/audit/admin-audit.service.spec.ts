import { Logger } from '@nestjs/common';
import type { AdminAuditEntry } from '@bitcrm/types';
import { traceStorage } from '@bitcrm/shared';
import { AdminAuditService, ADMIN_AUDIT_FIRST_MONTH } from '../../../src/audit/admin-audit.service';
import { createMockJwtUser } from '../mocks';

function make() {
  const repo = {
    record: jest.fn(async (_e: AdminAuditEntry) => undefined),
    page: jest.fn(async (_pk: string, _limit: number, _start?: Record<string, unknown>) => ({
      items: [] as AdminAuditEntry[],
      lastKey: undefined as Record<string, unknown> | undefined,
    })),
  };
  return { repo, service: new AdminAuditService(repo as never) };
}

const ACTOR = createMockJwtUser({ id: 'u-admin', email: 'admin@x.y', roleId: 'role-admin' });

describe('AdminAuditService.record', () => {
  let log: jest.SpyInstance;
  let error: jest.SpyInstance;
  beforeEach(() => {
    log = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    error = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  it('stores who did what to whom, with the request trace id', async () => {
    const { service, repo } = make();

    await traceStorage.run('eb532b07', () =>
      service.record(ACTOR, 'user.role_changed', { type: 'user', id: 'u-t', label: 'Bob <b@x.y>' }, {
        roleId: { from: 'role-technician', to: 'role-dispatcher' },
      }),
    );

    expect(repo.record).toHaveBeenCalledWith({
      id: expect.any(String),
      at: expect.stringMatching(/^\d{4}-\d\d-\d\dT/),
      action: 'user.role_changed',
      actorId: 'u-admin',
      actorEmail: 'admin@x.y',
      actorRoleId: 'role-admin',
      targetType: 'user',
      targetId: 'u-t',
      targetLabel: 'Bob <b@x.y>',
      changes: { roleId: { from: 'role-technician', to: 'role-dispatcher' } },
      traceId: 'eb532b07',
    });
  });

  it('writes one greppable AUDIT log line, with ids and no email', async () => {
    const { service } = make();

    await service.record(ACTOR, 'user.deactivated', { type: 'user', id: 'u-t', label: 'Bob <b@x.y>' });

    const line = String(log.mock.calls[0][0]);
    expect(line).toMatch(/^AUDIT user\.deactivated user:u-t by u-admin \(role-admin\)/);
    expect(line).not.toContain('@');
  });

  it('never fails the action it records: a failed write is logged with the whole entry', async () => {
    const { service, repo } = make();
    repo.record.mockRejectedValueOnce(new Error('throttled'));

    await expect(service.record(ACTOR, 'user.deactivated', { type: 'user', id: 'u-t' })).resolves.toBeUndefined();

    expect(String(error.mock.calls[0][0])).toContain('AUDIT WRITE FAILED');
    expect(String(error.mock.calls[0][0])).toContain('"targetId":"u-t"');
  });
});

describe('AdminAuditService.list', () => {
  it("reads one subject's history from its own partition", async () => {
    const { service, repo } = make();
    await service.list({ targetType: 'user', targetId: 'u-t', limit: 20 });
    expect(repo.page).toHaveBeenCalledWith('ADMINAUDIT#USER#u-t', 20, undefined);
  });

  it("reads one actor's history from theirs", async () => {
    const { service, repo } = make();
    await service.list({ actorId: 'u-admin', limit: 20 });
    expect(repo.page).toHaveBeenCalledWith('ADMINAUDIT#ACTOR#u-admin', 20, undefined);
  });

  it('walks the months newest first until the page is full, and resumes from the cursor', async () => {
    const { service, repo } = make();
    const e = (id: string) => ({ id }) as AdminAuditEntry;
    repo.page
      .mockResolvedValueOnce({ items: [e('1')], lastKey: undefined }) // 2026-12, done
      .mockResolvedValueOnce({ items: [e('2'), e('3')], lastKey: { PK: 'ADMINAUDIT#2026-11', SK: 's3' } });

    const first = await service.list({ limit: 3, now: new Date('2026-12-05T00:00:00Z') });

    expect(repo.page.mock.calls.map((c) => [c[0], c[1]])).toEqual([
      ['ADMINAUDIT#2026-12', 3],
      ['ADMINAUDIT#2026-11', 2],
    ]);
    expect(first.items.map((i) => i.id)).toEqual(['1', '2', '3']);
    expect(first.nextCursor).toBeDefined();

    repo.page.mockClear();
    repo.page.mockResolvedValue({ items: [], lastKey: undefined });
    const second = await service.list({ limit: 3, cursor: first.nextCursor, now: new Date('2026-12-05T00:00:00Z') });
    expect(repo.page.mock.calls[0]).toEqual(['ADMINAUDIT#2026-11', 3, { PK: 'ADMINAUDIT#2026-11', SK: 's3' }]);
    // Down to the first month there is a trail for, and no further.
    expect(repo.page.mock.calls.at(-1)![0]).toBe(`ADMINAUDIT#${ADMIN_AUDIT_FIRST_MONTH}`);
    expect(second.nextCursor).toBeUndefined();
  });

  it('ignores a cursor it cannot read rather than 500', async () => {
    const { service, repo } = make();
    await service.list({ limit: 5, cursor: 'garbage', now: new Date('2026-10-20T00:00:00Z') });
    expect(repo.page.mock.calls[0]).toEqual(['ADMINAUDIT#2026-10', 5, undefined]);
  });
});
