import {
  http,
  setAuthTokenProvider,
  setTokenRefresher,
  setUnauthorizedHandler,
} from './http';
import { ApiError } from './errors';
import { env } from '../env';

const reply = (status: number, body: unknown) => ({
  ok: status >= 200 && status < 300,
  status,
  statusText: 'x',
  json: () => Promise.resolve(body),
});

function mockFetchOnce(status: number, body: unknown): jest.Mock {
  const fn = jest.fn().mockResolvedValue(reply(status, body));
  global.fetch = fn as unknown as typeof fetch;
  return fn;
}

/** Queues one reply per call, in order. */
function mockFetchSequence(...replies: [number, unknown][]): jest.Mock {
  const fn = jest.fn();
  for (const [status, body] of replies) {
    fn.mockResolvedValueOnce(reply(status, body));
  }
  global.fetch = fn as unknown as typeof fetch;
  return fn;
}

describe('http client', () => {
  beforeEach(() => {
    setAuthTokenProvider(() => null);
    setUnauthorizedHandler(() => {});
    setTokenRefresher(null);
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

  it('invokes the unauthorized handler on 401 when nothing can refresh', async () => {
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

  it('reads the message out of the gateway shape nginx uses for a dead service', async () => {
    mockFetchOnce(503, {
      success: false,
      error: { code: 'SERVICE_UNAVAILABLE', message: 'deal-service is down' },
    });
    await expect(http.get('/deals')).rejects.toMatchObject({
      status: 503,
      message: 'deal-service is down',
    });
  });

  describe('paginated', () => {
    it('keeps the cursor the plain helpers throw away', async () => {
      mockFetchOnce(200, {
        success: true,
        data: [{ id: 'd1' }],
        pagination: { nextCursor: 'abc', count: 1 },
      });
      await expect(http.paginated('/deals')).resolves.toEqual({
        data: [{ id: 'd1' }],
        pagination: { nextCursor: 'abc', count: 1 },
      });
    });

    it('survives a page that is a bare success with no list', async () => {
      mockFetchOnce(200, { success: true, data: null });
      await expect(http.paginated('/deals')).resolves.toEqual({
        data: [],
        pagination: {},
      });
    });
  });

  describe('token refresh on 401', () => {
    it('refreshes once and replays the request', async () => {
      const onUnauth = jest.fn();
      setUnauthorizedHandler(onUnauth);
      const refresher = jest.fn().mockResolvedValue(true);
      setTokenRefresher(refresher);

      const fetchMock = mockFetchSequence(
        [401, { success: false, message: 'expired' }],
        [200, { success: true, data: { id: 'u-1' } }],
      );

      await expect(http.get('/users/me')).resolves.toEqual({ id: 'u-1' });
      expect(refresher).toHaveBeenCalledTimes(1);
      expect(fetchMock).toHaveBeenCalledTimes(2);
      // The session was never in danger, so nothing signed the technician out.
      expect(onUnauth).not.toHaveBeenCalled();
    });

    it('ends the session when the refresh itself is refused', async () => {
      const onUnauth = jest.fn();
      setUnauthorizedHandler(onUnauth);
      setTokenRefresher(jest.fn().mockResolvedValue(false));
      mockFetchOnce(401, { success: false, message: 'expired' });

      await expect(http.get('/users/me')).rejects.toMatchObject({ status: 401 });
      expect(onUnauth).toHaveBeenCalledTimes(1);
    });

    it('ends the session when the replayed request is refused too', async () => {
      const onUnauth = jest.fn();
      setUnauthorizedHandler(onUnauth);
      setTokenRefresher(jest.fn().mockResolvedValue(true));
      mockFetchSequence(
        [401, { success: false, message: 'expired' }],
        [401, { success: false, message: 'still expired' }],
      );

      await expect(http.get('/users/me')).rejects.toMatchObject({ status: 401 });
      expect(onUnauth).toHaveBeenCalledTimes(1);
    });

    it('treats a throwing refresher as a refusal rather than crashing the request', async () => {
      const onUnauth = jest.fn();
      setUnauthorizedHandler(onUnauth);
      setTokenRefresher(jest.fn().mockRejectedValue(new Error('keychain locked')));
      mockFetchOnce(401, { success: false, message: 'expired' });

      await expect(http.get('/users/me')).rejects.toMatchObject({ status: 401 });
      expect(onUnauth).toHaveBeenCalledTimes(1);
    });

    it('shares ONE refresh between requests that 401 together', async () => {
      // The job screen opens three requests at once. Cognito rotates the
      // refresh token, so three exchanges would sign out a healthy session.
      let resolveRefresh: (v: boolean) => void = () => {};
      const refresher = jest.fn(
        () =>
          new Promise<boolean>((resolve) => {
            resolveRefresh = resolve;
          }),
      );
      setTokenRefresher(refresher);

      const fetchMock = jest.fn().mockImplementation(() => {
        const calls = fetchMock.mock.calls.length;
        return Promise.resolve(
          calls <= 3
            ? reply(401, { success: false, message: 'expired' })
            : reply(200, { success: true, data: { ok: true } }),
        );
      });
      global.fetch = fetchMock as unknown as typeof fetch;

      const inFlight = Promise.all([
        http.get('/deals/d1'),
        http.get('/deals/d1/timeline'),
        http.get('/deals/d1/attachments'),
      ]);
      // Let all three reach the 401 handler before the refresh settles.
      while (fetchMock.mock.calls.length < 3) {
        await new Promise((resolve) => setImmediate(resolve));
      }
      await new Promise((resolve) => setImmediate(resolve));
      resolveRefresh(true);

      await expect(inFlight).resolves.toEqual([
        { ok: true },
        { ok: true },
        { ok: true },
      ]);
      expect(refresher).toHaveBeenCalledTimes(1);
    });

    it('never asks to refresh on the refresh call itself', async () => {
      const refresher = jest.fn().mockResolvedValue(true);
      setTokenRefresher(refresher);
      mockFetchOnce(401, { success: false, message: 'refresh token revoked' });

      await expect(
        http.postWithoutRefresh('/users/auth/refresh', { refreshToken: 'x' }),
      ).rejects.toMatchObject({ status: 401 });
      expect(refresher).not.toHaveBeenCalled();
    });
  });
});
