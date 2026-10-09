import { SecurityController } from '../../../src/security/security.controller';

/** Thin: validate, delegate, wrap. Reading is any signed-in user's; changing is `settings.edit`. */
function make() {
  const security = {
    getSettings: jest.fn(async () => ({ requireMfa: true, loginCodeByEmail: false, otpByEmail: false })),
    updateSettings: jest.fn(async (dto: unknown, actorId: string) => ({ requireMfa: false, loginCodeByEmail: false, otpByEmail: false, updatedBy: actorId })),
    listAudit: jest.fn(async () => [{ actorId: 'u-1' }]),
  };
  return { controller: new SecurityController(security as never), security };
}

const ME = { id: 'u-admin', cognitoSub: 's', email: 'e', roleId: 'r', department: 'd' };

function permissionOf(method: keyof SecurityController) {
  return Reflect.getMetadataKeys(SecurityController.prototype[method])
    .map((k) => Reflect.getMetadata(k, SecurityController.prototype[method]))
    .find((v) => v && typeof v === 'object' && 'resource' in v);
}

describe('SecurityController', () => {
  it('GET /security-settings answers the row for any signed-in user', async () => {
    const { controller } = make();

    await expect(controller.get()).resolves.toEqual({
      success: true,
      data: { requireMfa: true, loginCodeByEmail: false, otpByEmail: false },
    });
    expect(permissionOf('get')).toBeUndefined();
  });

  it('PUT /security-settings saves the switches as the caller, behind settings.edit', async () => {
    const { controller, security } = make();

    const res = await controller.update({ requireMfa: false }, ME);

    expect(security.updateSettings).toHaveBeenCalledWith({ requireMfa: false }, 'u-admin');
    expect(res).toEqual({ success: true, data: expect.objectContaining({ updatedBy: 'u-admin' }) });
    expect(permissionOf('update')).toMatchObject({ resource: 'settings', action: 'edit' });
  });

  it('GET /security-settings/audit lists the changes, behind settings.edit', async () => {
    const { controller, security } = make();

    await expect(controller.audit('25')).resolves.toEqual({ success: true, data: [{ actorId: 'u-1' }] });
    expect(security.listAudit).toHaveBeenCalledWith(25);
    expect(permissionOf('audit')).toMatchObject({ resource: 'settings', action: 'edit' });
  });

  it('caps and defaults the audit page size', async () => {
    const { controller, security } = make();

    await controller.audit(undefined);
    await controller.audit('999');
    await controller.audit('abc');

    expect(security.listAudit.mock.calls.map((c) => c[0])).toEqual([50, 200, 50]);
  });
});
