import { PermissionCacheReader } from 'src/auth/permission-cache-reader';

/**
 * Every signed-in request reads these two keys. A Redis error used to escape
 * into CognitoAuthGuard's catch and come back as "invalid token" (401).
 */
describe('PermissionCacheReader with Redis unavailable', () => {
  const fail = jest.fn(async () => {
    throw new Error('Connection is closed.');
  });
  const reader = new PermissionCacheReader({ client: { get: fail, set: fail, del: fail } } as never);

  it('treats the disabled flag as absent (Cognito disables the account as well)', async () => {
    await expect(reader.isUserDisabled('u1')).resolves.toBe(false);
  });

  it('reports a permissions miss, so the guard asks user-service', async () => {
    await expect(reader.getPermissions('u1', 'r1')).resolves.toBeNull();
  });
});
