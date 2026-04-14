import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { CognitoAuthGuard } from '../../../src/auth/auth.guard';

const mockVerify = jest.fn();

jest.mock('aws-jwt-verify', () => ({
  CognitoJwtVerifier: {
    create: () => ({ verify: mockVerify }),
  },
}));

describe('CognitoAuthGuard', () => {
  let guard: CognitoAuthGuard;
  let reflector: Reflector;

  const createMockContext = (
    headers: Record<string, string | undefined> = {},
    user?: unknown,
  ): ExecutionContext => {
    const request = { headers, user } as Record<string, unknown>;
    return {
      switchToHttp: () => ({
        getRequest: () => request,
      }),
      getHandler: () => jest.fn(),
      getClass: () => jest.fn(),
    } as unknown as ExecutionContext;
  };

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.COGNITO_USER_POOL_ID = 'test-pool-id';
    process.env.COGNITO_CLIENT_ID = 'test-client-id';
    reflector = new Reflector();
    const mockCacheReader = {
      isUserDisabled: jest.fn().mockResolvedValue(false),
    } as any;
    guard = new CognitoAuthGuard(reflector, mockCacheReader);
  });

  afterEach(() => {
    delete process.env.COGNITO_USER_POOL_ID;
    delete process.env.COGNITO_CLIENT_ID;
  });

  it('should return true for @Public() routes', async () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(true);
    const context = createMockContext();

    expect(await guard.canActivate(context)).toBe(true);
    expect(mockVerify).not.toHaveBeenCalled();
  });

  it('should throw UnauthorizedException when Cognito is not configured', async () => {
    delete process.env.COGNITO_USER_POOL_ID;
    delete process.env.COGNITO_CLIENT_ID;
    const unconfiguredGuard = new CognitoAuthGuard(reflector, { isUserDisabled: jest.fn() } as any);
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);
    const context = createMockContext({ authorization: 'Bearer token' });

    await expect(unconfiguredGuard.canActivate(context)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('should throw UnauthorizedException when no Authorization header', async () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);
    const context = createMockContext({});

    await expect(guard.canActivate(context)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('should throw UnauthorizedException when not Bearer type', async () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);
    const context = createMockContext({ authorization: 'Basic abc123' });

    await expect(guard.canActivate(context)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('should throw UnauthorizedException when token verification fails', async () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);
    mockVerify.mockRejectedValue(new Error('Invalid token'));
    const context = createMockContext({ authorization: 'Bearer bad-token' });

    await expect(guard.canActivate(context)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('should populate request.user with correct fields on valid token', async () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);
    mockVerify.mockResolvedValue({
      sub: 'cognito-sub-123',
      email: 'test@example.com',
      'custom:user_id': 'user-123',
      'custom:role_id': 'role-admin',
      'custom:department': 'Engineering',
    });

    const context = createMockContext({ authorization: 'Bearer valid-token' });
    await guard.canActivate(context);

    const request = context.switchToHttp().getRequest() as Record<string, unknown>;
    expect(request.user).toEqual({
      id: 'user-123',
      cognitoSub: 'cognito-sub-123',
      email: 'test@example.com',
      roleId: 'role-admin',
      department: 'Engineering',
    });
  });

  it('should fall back to username when email claim is missing', async () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);
    mockVerify.mockResolvedValue({
      sub: 'cognito-sub-123',
      username: 'testuser',
      'custom:user_id': 'user-123',
      'custom:role_id': 'role-admin',
      'custom:department': 'Engineering',
    });

    const context = createMockContext({ authorization: 'Bearer valid-token' });
    await guard.canActivate(context);

    const request = context.switchToHttp().getRequest() as Record<string, unknown>;
    expect((request.user as Record<string, unknown>).email).toBe('testuser');
  });

  it('should return true on successful verification', async () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);
    mockVerify.mockResolvedValue({
      sub: 'cognito-sub-123',
      email: 'test@example.com',
      'custom:user_id': 'user-123',
      'custom:role_id': 'role-admin',
      'custom:department': 'Engineering',
    });

    const context = createMockContext({ authorization: 'Bearer valid-token' });
    expect(await guard.canActivate(context)).toBe(true);
  });
});
