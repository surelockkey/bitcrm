import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PermissionGuard } from '../../../src/auth/permission.guard';
import { PermissionCacheReader } from '../../../src/auth/permission-cache-reader';
import { PERMISSION_KEY } from '../../../src/auth/permission.decorator';
import { type ResolvedPermissions, DataScope } from '@bitcrm/types';

function createMockExecutionContext(user: any): ExecutionContext {
  const request = { user, resolvedPermissions: undefined as any };
  return {
    switchToHttp: () => ({
      getRequest: () => request,
    }),
    getHandler: () => jest.fn(),
    getClass: () => jest.fn(),
  } as unknown as ExecutionContext;
}

function makeResolvedPermissions(
  overrides: Partial<ResolvedPermissions> = {},
): ResolvedPermissions {
  return {
    roleId: 'role-1',
    roleName: 'Sales Manager',
    isSystemRole: false,
    permissions: {},
    dataScope: {},
    dealStageTransitions: [],
    hasOverrides: false,
    ...overrides,
  };
}

describe('PermissionGuard', () => {
  let guard: PermissionGuard;
  let reflector: Reflector;
  let cacheReader: jest.Mocked<PermissionCacheReader>;

  const defaultUser = {
    id: 'user-1',
    cognitoSub: 'sub-1',
    email: 'user@test.com',
    roleId: 'role-1',
    department: 'sales',
  };

  beforeEach(() => {
    reflector = new Reflector();
    cacheReader = {
      getPermissions: jest.fn(),
    } as unknown as jest.Mocked<PermissionCacheReader>;

    guard = new PermissionGuard(reflector, cacheReader);
  });

  it('should allow when user has the required permission', async () => {
    jest
      .spyOn(reflector, 'getAllAndOverride')
      .mockImplementation((key: any) => {
        if (key === PERMISSION_KEY) return { resource: 'deals', action: 'create' };
        return undefined;
      });

    cacheReader.getPermissions.mockResolvedValue(
      makeResolvedPermissions({
        permissions: {
          deals: { view: true, create: true, edit: true, delete: false },
        },
      }),
    );

    const context = createMockExecutionContext(defaultUser);
    const result = await guard.canActivate(context);

    expect(result).toBe(true);
  });

  it('should deny (throw ForbiddenException) when permission is false', async () => {
    jest
      .spyOn(reflector, 'getAllAndOverride')
      .mockImplementation((key: any) => {
        if (key === PERMISSION_KEY) return { resource: 'deals', action: 'delete' };
        return undefined;
      });

    cacheReader.getPermissions.mockResolvedValue(
      makeResolvedPermissions({
        permissions: {
          deals: { view: true, create: false, edit: true, delete: false },
        },
      }),
    );

    const context = createMockExecutionContext(defaultUser);

    await expect(guard.canActivate(context)).rejects.toThrow(ForbiddenException);
  });

  it('should deny when permission is absent (deny-by-default)', async () => {
    jest
      .spyOn(reflector, 'getAllAndOverride')
      .mockImplementation((key: any) => {
        if (key === PERMISSION_KEY) return { resource: 'reports', action: 'view' };
        return undefined;
      });

    cacheReader.getPermissions.mockResolvedValue(
      makeResolvedPermissions({
        permissions: {
          deals: { view: true, create: true },
        },
      }),
    );

    const context = createMockExecutionContext(defaultUser);

    await expect(guard.canActivate(context)).rejects.toThrow(ForbiddenException);
  });

  it('should allow when no decorator is present (no PERMISSION_KEY, no ROLES_KEY)', async () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(undefined);

    const context = createMockExecutionContext(defaultUser);
    const result = await guard.canActivate(context);

    expect(result).toBe(true);
  });


  it('should allow Super Admin regardless of permission matrix', async () => {
    jest
      .spyOn(reflector, 'getAllAndOverride')
      .mockImplementation((key: any) => {
        if (key === PERMISSION_KEY) return { resource: 'deals', action: 'delete' };
        return undefined;
      });

    cacheReader.getPermissions.mockResolvedValue(
      makeResolvedPermissions({
        roleName: 'Super Admin',
        isSystemRole: true,
        permissions: {
          // Intentionally missing deals.delete to prove bypass works
          deals: { view: true },
        },
      }),
    );

    const superAdminUser = { ...defaultUser, roleId: 'role-sa' };
    const context = createMockExecutionContext(superAdminUser);
    const result = await guard.canActivate(context);

    expect(result).toBe(true);
  });

  it('should attach resolvedPermissions to request object', async () => {
    const resolved = makeResolvedPermissions({
      permissions: {
        deals: { view: true, create: true },
      },
    });

    jest
      .spyOn(reflector, 'getAllAndOverride')
      .mockImplementation((key: any) => {
        if (key === PERMISSION_KEY) return { resource: 'deals', action: 'create' };
        return undefined;
      });

    cacheReader.getPermissions.mockResolvedValue(resolved);

    const context = createMockExecutionContext(defaultUser);
    await guard.canActivate(context);

    const request = context.switchToHttp().getRequest() as any;
    expect(request.resolvedPermissions).toEqual(resolved);
  });

  it('should throw ForbiddenException when both cache and internal API return null', async () => {
    jest
      .spyOn(reflector, 'getAllAndOverride')
      .mockImplementation((key: any) => {
        if (key === PERMISSION_KEY) return { resource: 'deals', action: 'view' };
        return undefined;
      });

    cacheReader.getPermissions.mockResolvedValue(null);
    // Mock fetch to simulate internal API failure
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 404 });

    const context = createMockExecutionContext(defaultUser);

    await expect(guard.canActivate(context)).rejects.toThrow(ForbiddenException);
  });

  it('should allow user with override that grants permission (merged result)', async () => {
    jest
      .spyOn(reflector, 'getAllAndOverride')
      .mockImplementation((key: any) => {
        if (key === PERMISSION_KEY) return { resource: 'deals', action: 'create' };
        return undefined;
      });

    // The resolved permissions already contain the merged result from PermissionResolverService
    cacheReader.getPermissions.mockResolvedValue(
      makeResolvedPermissions({
        hasOverrides: true,
        permissions: {
          deals: { view: true, create: true, edit: true, delete: false },
        },
      }),
    );

    const context = createMockExecutionContext(defaultUser);
    const result = await guard.canActivate(context);

    expect(result).toBe(true);
  });
});
