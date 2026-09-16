import { ServiceUnavailableException } from '@nestjs/common';
import { UserLookupService } from '../../../src/api/access/user-lookup.service';
import { mockFetch } from './api-mocks';

describe('UserLookupService', () => {
  const env = process.env;
  beforeEach(() => {
    process.env = { ...env, USER_SERVICE_URL: 'http://user:4001', INTERNAL_SERVICE_SECRET: 's3cret' };
  });
  afterEach(() => {
    process.env = env;
  });

  it('reads the user from the internal route with the secret and caches it', async () => {
    const fetchImpl = mockFetch({
      '/api/users/internal/u9': { body: { data: { id: 'u9', firstName: 'Tamir', lastName: 'Levi', roleId: 'r1' } } },
    });
    const svc = new UserLookupService(fetchImpl);
    expect(await svc.find('u9')).toEqual({ id: 'u9', name: 'Tamir Levi', email: undefined, roleId: 'r1', status: undefined });
    expect(fetchImpl).toHaveBeenCalledWith('http://user:4001/api/users/internal/u9', {
      headers: { 'x-internal-secret': 's3cret' },
    });
    await svc.find('u9');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('a 404 is null (cached); an empty id is null without a call', async () => {
    const fetchImpl = mockFetch({});
    const svc = new UserLookupService(fetchImpl);
    expect(await svc.find('ghost')).toBeNull();
    expect(await svc.find('ghost')).toBeNull();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(await svc.find('')).toBeNull();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('a 5xx or a network failure is a 503 to the caller, never a silent "no such user"', async () => {
    await expect(new UserLookupService(mockFetch({ '/api/users/internal/u1': { status: 500 } })).find('u1')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    await expect(
      new UserLookupService(mockFetch({ '/api/users/internal/u1': new Error('ECONNREFUSED') })).find('u1'),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('falls back to the email, then the id, for a name', async () => {
    const svc = new UserLookupService(mockFetch({ '/api/users/internal/u2': { body: { data: { id: 'u2', email: 'x@y.z' } } } }));
    expect((await svc.find('u2'))?.name).toBe('x@y.z');
  });
});
