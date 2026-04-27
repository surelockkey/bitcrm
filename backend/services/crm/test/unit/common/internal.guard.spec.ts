import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { InternalGuard } from 'src/common/guards/internal.guard';

function createMockExecutionContext(headers: Record<string, string>): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ headers }),
    }),
  } as unknown as ExecutionContext;
}

describe('InternalGuard', () => {
  let guard: InternalGuard;

  beforeEach(() => {
    guard = new InternalGuard();
  });

  afterEach(() => {
    delete process.env.INTERNAL_SERVICE_SECRET;
  });

  it('should allow request with correct secret', () => {
    process.env.INTERNAL_SERVICE_SECRET = 'my-secret';
    const context = createMockExecutionContext({ 'x-internal-secret': 'my-secret' });

    const result = guard.canActivate(context);

    expect(result).toBe(true);
  });

  it('should reject request with wrong secret', () => {
    process.env.INTERNAL_SERVICE_SECRET = 'my-secret';
    const context = createMockExecutionContext({ 'x-internal-secret': 'wrong-secret' });

    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });

  it('should reject request with missing secret header', () => {
    process.env.INTERNAL_SERVICE_SECRET = 'my-secret';
    const context = createMockExecutionContext({});

    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });

  it('should reject when INTERNAL_SERVICE_SECRET env is not set', () => {
    delete process.env.INTERNAL_SERVICE_SECRET;
    const context = createMockExecutionContext({ 'x-internal-secret': 'any-value' });

    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });

  it('should reject when both env and header are undefined', () => {
    delete process.env.INTERNAL_SERVICE_SECRET;
    const context = createMockExecutionContext({});

    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });
});
