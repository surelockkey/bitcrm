import { MfaController } from '../../../src/mfa/mfa.controller';

/** Thin: the caller's own switch under `me`, an admin's under `:id` — validate, delegate, wrap. */
function make() {
  const mfa = {
    startEnrollment: jest.fn(async () => ({ destination: '•••• 1234' })),
    confirmEnrollment: jest.fn(async () => ({ id: 'u-1', smsMfaEnabled: true })),
    disable: jest.fn(async () => ({ id: 'u-1', smsMfaEnabled: false })),
    setByAdmin: jest.fn(async (_id: string, enabled: boolean) => ({ id: 'u-9', smsMfaEnabled: enabled })),
  };
  return { controller: new MfaController(mfa as never), mfa };
}

const ME = { id: 'u-1', cognitoSub: 's', email: 'e', roleId: 'r', department: 'd' };

describe('MfaController', () => {
  it('POST /me/mfa/start texts a code to the caller\'s own phone', async () => {
    const { controller, mfa } = make();

    await expect(controller.start(ME)).resolves.toEqual({ success: true, data: { destination: '•••• 1234' } });
    expect(mfa.startEnrollment).toHaveBeenCalledWith('u-1');
  });

  it('POST /me/mfa/confirm switches it on for the caller only', async () => {
    const { controller, mfa } = make();

    const res = await controller.confirm({ code: '123456' }, ME);

    expect(mfa.confirmEnrollment).toHaveBeenCalledWith('u-1', '123456');
    expect(res).toEqual({ success: true, data: { id: 'u-1', smsMfaEnabled: true } });
  });

  it('DELETE /me/mfa switches it off for the caller', async () => {
    const { controller, mfa } = make();

    await controller.disable(ME);

    expect(mfa.disable).toHaveBeenCalledWith('u-1');
  });

  it('PUT /:id/mfa is an admin\'s switch for someone else', async () => {
    const { controller, mfa } = make();

    const res = await controller.setForUser('u-9', { enabled: false });

    expect(mfa.setByAdmin).toHaveBeenCalledWith('u-9', false);
    expect(res.data).toEqual({ id: 'u-9', smsMfaEnabled: false });
  });

  it('guards the admin switch with users.edit', () => {
    const meta = Reflect.getMetadataKeys(MfaController.prototype.setForUser)
      .map((k) => Reflect.getMetadata(k, MfaController.prototype.setForUser))
      .find((v) => v && typeof v === 'object' && 'resource' in v);
    expect(meta).toMatchObject({ resource: 'users', action: 'edit' });
  });
});
