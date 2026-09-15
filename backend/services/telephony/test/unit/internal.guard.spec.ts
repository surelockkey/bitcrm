import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { InternalGuard } from '../../src/common/guards/internal.guard';

function createMockExecutionContext(headers: Record<string, string>): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ headers }),
    }),
  } as unknown as ExecutionContext;
}

describe('InternalGuard', () => {
  let guard: InternalGuard;
  const saved = process.env.INTERNAL_SERVICE_SECRET;

  beforeEach(() => {
    guard = new InternalGuard();
  });

  afterEach(() => {
    if (saved === undefined) delete process.env.INTERNAL_SERVICE_SECRET;
    else process.env.INTERNAL_SERVICE_SECRET = saved;
  });

  it('allows a request carrying the shared secret', () => {
    process.env.INTERNAL_SERVICE_SECRET = 'my-secret';
    const context = createMockExecutionContext({ 'x-internal-secret': 'my-secret' });
    expect(guard.canActivate(context)).toBe(true);
  });

  it('rejects a wrong secret', () => {
    process.env.INTERNAL_SERVICE_SECRET = 'my-secret';
    const context = createMockExecutionContext({ 'x-internal-secret': 'wrong-secret' });
    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });

  it('rejects a missing header', () => {
    process.env.INTERNAL_SERVICE_SECRET = 'my-secret';
    expect(() => guard.canActivate(createMockExecutionContext({}))).toThrow(
      ForbiddenException,
    );
  });

  it('rejects everything when no secret is configured', () => {
    delete process.env.INTERNAL_SERVICE_SECRET;
    const context = createMockExecutionContext({ 'x-internal-secret': 'any-value' });
    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
    expect(() => guard.canActivate(createMockExecutionContext({}))).toThrow(
      ForbiddenException,
    );
  });
});
