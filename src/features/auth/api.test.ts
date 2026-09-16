import { http } from '../../lib/api/http';
import { getMe, login, refresh } from './api';

jest.mock('../../lib/api/http', () => ({
  http: { get: jest.fn(), post: jest.fn() },
}));

const mockHttp = http as jest.Mocked<typeof http>;

describe('auth api', () => {
  it('logs in via POST /users/auth/login with the credentials', async () => {
    const tokens = {
      idToken: 'i',
      accessToken: 'a',
      refreshToken: 'r',
      expiresIn: 3600,
    };
    mockHttp.post.mockResolvedValue(tokens);
    const body = { email: 'tech@slk-s.com', password: 'secret' };

    await expect(login(body)).resolves.toEqual(tokens);
    expect(mockHttp.post).toHaveBeenCalledWith('/users/auth/login', body);
  });

  it('fetches the current user via GET /users/me', async () => {
    const user = { id: '42', email: 'tech@slk-s.com' };
    mockHttp.get.mockResolvedValue(user);

    await expect(getMe()).resolves.toEqual(user);
    expect(mockHttp.get).toHaveBeenCalledWith('/users/me');
  });

  it('refreshes tokens via POST /users/auth/refresh', async () => {
    mockHttp.post.mockResolvedValue({
      idToken: 'i2',
      accessToken: 'a2',
      expiresIn: 3600,
    });

    await refresh('REFRESH_1');
    expect(mockHttp.post).toHaveBeenCalledWith('/users/auth/refresh', {
      refreshToken: 'REFRESH_1',
    });
  });
});
