import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { InternalGuard } from 'src/common/guards/internal.guard';

describe('InternalGuard', () => {
  let guard: InternalGuard;

  beforeEach(() => {
    guard = new InternalGuard();
    process.env.INTERNAL_SERVICE_SECRET = 'test-secret';
  });

  afterEach(() => {
    delete process.env.INTERNAL_SERVICE_SECRET;
  });

  function createMockContext(secret?: string): ExecutionContext {
    return {
      switchToHttp: () => ({
        getRequest: () => ({
          headers: secret ? { 'x-internal-secret': secret } : {},
        }),
      }),
    } as unknown as ExecutionContext;
  }

  it('should allow access with correct secret', () => {
    const ctx = createMockContext('test-secret');
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('should deny access with wrong secret', () => {
    const ctx = createMockContext('wrong-secret');
    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });

  it('should deny access with missing secret', () => {
    const ctx = createMockContext();
    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });

  it('should deny access when env var is not set', () => {
    delete process.env.INTERNAL_SERVICE_SECRET;
    const ctx = createMockContext('test-secret');
    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });
});
