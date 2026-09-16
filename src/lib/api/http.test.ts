import {
  http,
  setAuthTokenProvider,
  setUnauthorizedHandler,
} from './http';
import { ApiError } from './errors';
import { env } from '../env';

function mockFetchOnce(status: number, body: unknown): jest.Mock {
  const fn = jest.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    statusText: 'x',
    json: () => Promise.resolve(body),
  });
  global.fetch = fn as unknown as typeof fetch;
  return fn;
}

describe('http client', () => {
  beforeEach(() => {
    setAuthTokenProvider(() => null);
    setUnauthorizedHandler(() => {});
  });

  it('unwraps the { success, data } envelope and returns data', async () => {
    mockFetchOnce(200, { success: true, data: { hello: 'world' } });
    await expect(http.get('/users/me')).resolves.toEqual({ hello: 'world' });
  });

  it('prefixes the configured API base URL', async () => {
    const fetchMock = mockFetchOnce(200, { success: true, data: {} });
    await http.get('/users/me');
    expect(fetchMock).toHaveBeenCalledWith(
      `${env.apiBaseUrl}/users/me`,
      expect.anything(),
    );
  });

  it('sends a JSON body with a Content-Type header on POST', async () => {
    const fetchMock = mockFetchOnce(200, { success: true, data: {} });
    await http.post('/users/auth/login', { email: 'a@b.co', password: 'x' });
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.method).toBe('POST');
    expect(init.body).toBe(JSON.stringify({ email: 'a@b.co', password: 'x' }));
    const headers = new Headers(init.headers);
    expect(headers.get('Content-Type')).toBe('application/json');
  });

  it('attaches the Bearer id token when a provider yields one', async () => {
    setAuthTokenProvider(() => 'ID_TOKEN_123');
    const fetchMock = mockFetchOnce(200, { success: true, data: {} });
    await http.get('/users/me');
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    const headers = new Headers(init.headers);
    expect(headers.get('Authorization')).toBe('Bearer ID_TOKEN_123');
  });

  it('omits Authorization when there is no token', async () => {
    const fetchMock = mockFetchOnce(200, { success: true, data: {} });
    await http.get('/users/me');
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(new Headers(init.headers).has('Authorization')).toBe(false);
  });

  it('throws ApiError with status and message on a failed response', async () => {
    mockFetchOnce(400, { success: false, message: 'Bad creds' });
    await expect(http.post('/users/auth/login', {})).rejects.toMatchObject({
      status: 400,
      message: 'Bad creds',
    });
    await expect(http.post('/users/auth/login', {})).rejects.toBeInstanceOf(
      ApiError,
    );
  });

  it('invokes the unauthorized handler on 401', async () => {
    const onUnauth = jest.fn();
    setUnauthorizedHandler(onUnauth);
    mockFetchOnce(401, { success: false, message: 'expired' });
    await expect(http.get('/users/me')).rejects.toBeInstanceOf(ApiError);
    expect(onUnauth).toHaveBeenCalledTimes(1);
  });

  it('surfaces a clean ApiError(0) when the network is unreachable', async () => {
    global.fetch = jest
      .fn()
      .mockRejectedValue(new Error('network down')) as unknown as typeof fetch;
    await expect(http.get('/users/me')).rejects.toMatchObject({ status: 0 });
  });
});
