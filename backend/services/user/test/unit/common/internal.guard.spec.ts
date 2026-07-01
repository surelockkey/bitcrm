import { ForbiddenException } from '@nestjs/common';
import { InternalGuard } from '../../../src/common/guards/internal.guard';

function ctx(headers: Record<string, string>) {
  return {
    switchToHttp: () => ({ getRequest: () => ({ headers }) }),
  } as never;
}

describe('InternalGuard', () => {
  const guard = new InternalGuard();

  afterEach(() => delete process.env.INTERNAL_SERVICE_SECRET);

  it('allows a request with the matching secret', () => {
    process.env.INTERNAL_SERVICE_SECRET = 's3cr3t';
    expect(guard.canActivate(ctx({ 'x-internal-secret': 's3cr3t' }))).toBe(true);
  });

  it('rejects a wrong secret', () => {
    process.env.INTERNAL_SERVICE_SECRET = 's3cr3t';
    expect(() => guard.canActivate(ctx({ 'x-internal-secret': 'nope' }))).toThrow(ForbiddenException);
  });

  it('rejects when no secret is configured (fail closed)', () => {
    expect(() => guard.canActivate(ctx({ 'x-internal-secret': 'anything' }))).toThrow(ForbiddenException);
  });

  it('rejects a missing header', () => {
    process.env.INTERNAL_SERVICE_SECRET = 's3cr3t';
    expect(() => guard.canActivate(ctx({}))).toThrow(ForbiddenException);
  });
});
