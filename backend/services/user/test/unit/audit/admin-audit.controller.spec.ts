import { AdminAuditController } from '../../../src/audit/admin-audit.controller';

function permissionOf(method: keyof AdminAuditController) {
  return Reflect.getMetadataKeys(AdminAuditController.prototype[method])
    .map((k) => Reflect.getMetadata(k, AdminAuditController.prototype[method]))
    .find((v) => v && typeof v === 'object' && 'resource' in v);
}

/** `GET /api/users/audit` — the trail, behind `users.edit` (who may change people may see who did). */
describe('AdminAuditController', () => {
  const audit = { list: jest.fn(async () => ({ items: [{ id: 'a' }], nextCursor: 'c2' })) };
  const controller = new AdminAuditController(audit as never);
  beforeEach(() => audit.list.mockClear());

  it('wraps the page in the envelope with the cursor as pagination', async () => {
    await expect(controller.list({ targetType: 'user', targetId: 'u-1', limit: '10' })).resolves.toEqual({
      success: true,
      data: [{ id: 'a' }],
      pagination: { nextCursor: 'c2' },
    });
    expect(audit.list).toHaveBeenCalledWith({ targetType: 'user', targetId: 'u-1', limit: 10 });
    expect(permissionOf('list')).toMatchObject({ resource: 'users', action: 'edit' });
  });

  it('defaults and caps the page size, and drops a target type it does not know', async () => {
    await controller.list({});
    await controller.list({ limit: '999' });
    await controller.list({ limit: 'x', targetType: 'deal', targetId: 'd-1', actorId: 'u-9', cursor: 'k' });
    expect(audit.list.mock.calls).toEqual([
      [{ limit: 50 }],
      [{ limit: 200 }],
      [{ limit: 50, actorId: 'u-9', cursor: 'k' }],
    ]);
  });
});
