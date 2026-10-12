import {
  clientConfirmPortalBase,
  clientConfirmSecret,
  clientConfirmUrl,
  signClientConfirmToken,
  verifyClientConfirmToken,
} from '../../../src/links/client-confirm-link';

const DEAL = '3f2b8c1e-9d4a-4b7e-8f21-0c5d6e7f8a9b';
const SECRET = 'test-secret-1';

describe('client confirm link (Workiz {{confirm_link}})', () => {
  it('signs a job into a 44-character url-safe token and reads the job back', () => {
    const token = signClientConfirmToken(DEAL, SECRET);
    expect(token).toMatch(/^[A-Za-z0-9_-]{44}$/);
    expect(verifyClientConfirmToken(token!, SECRET)).toBe(DEAL);
  });

  it('is the same link every time — a re-sent reminder carries the link the client already has', () => {
    expect(signClientConfirmToken(DEAL, SECRET)).toBe(signClientConfirmToken(DEAL, SECRET));
    expect(signClientConfirmToken(DEAL.toUpperCase(), SECRET)).toBe(signClientConfirmToken(DEAL, SECRET));
  });

  it('refuses a token signed with another secret, a tampered job or a tampered signature', () => {
    const token = signClientConfirmToken(DEAL, SECRET)!;
    expect(verifyClientConfirmToken(token, 'another-secret')).toBeNull();
    const other = signClientConfirmToken('11111111-2222-4333-8444-555555555555', SECRET)!;
    // The other job's id with this job's signature.
    expect(verifyClientConfirmToken(other.slice(0, 22) + token.slice(22), SECRET)).toBeNull();
    const at = (i: number, c: string) => token.slice(0, i) + c + token.slice(i + 1);
    expect(verifyClientConfirmToken(at(30, token[30] === 'Q' ? 'g' : 'Q'), SECRET)).toBeNull();
    // The last character of each half carries spare bits: only the canonical spelling is the link.
    const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
    const spare = (c: string) => B64[B64.indexOf(c) ^ 1];
    expect(verifyClientConfirmToken(at(43, spare(token[43])), SECRET)).toBeNull();
    expect(verifyClientConfirmToken(at(21, spare(token[21])), SECRET)).toBeNull();
  });

  it('answers null for anything that is not a token, and without a secret', () => {
    for (const bad of ['', 'abc', 'x'.repeat(43) + '!', `${DEAL}.sig`, 'a'.repeat(45)]) {
      expect(verifyClientConfirmToken(bad, SECRET)).toBeNull();
    }
    expect(verifyClientConfirmToken(signClientConfirmToken(DEAL, SECRET)!, '')).toBeNull();
    expect(signClientConfirmToken(DEAL, '')).toBeNull();
  });

  it('signs only job ids (uuids) — anything else gets no link', () => {
    expect(signClientConfirmToken('not-a-uuid', SECRET)).toBeNull();
    expect(signClientConfirmToken('', SECRET)).toBeNull();
  });

  it('builds <portal>/confirm/<token>, and nothing without a portal or a secret', () => {
    const url = clientConfirmUrl(DEAL, { portalBase: 'https://portal.example.com/', secret: SECRET });
    expect(url).toBe(`https://portal.example.com/confirm/${signClientConfirmToken(DEAL, SECRET)}`);
    expect(clientConfirmUrl(DEAL, { portalBase: '', secret: SECRET })).toBeUndefined();
    expect(clientConfirmUrl(DEAL, { portalBase: 'https://portal.example.com', secret: '' })).toBeUndefined();
  });

  it('reads the secret the portal tokens use: PORTAL_TOKEN_SECRET, else INTERNAL_SERVICE_SECRET', () => {
    expect(clientConfirmSecret({ PORTAL_TOKEN_SECRET: 'p', INTERNAL_SERVICE_SECRET: 'i' })).toBe('p');
    expect(clientConfirmSecret({ INTERNAL_SERVICE_SECRET: 'i' })).toBe('i');
    expect(clientConfirmSecret({})).toBe('');
  });

  it('finds the portal origin: PORTAL_BASE_URL, else the SSM portal domain every task carries', () => {
    expect(clientConfirmPortalBase({ PORTAL_BASE_URL: 'http://localhost:3002/' })).toBe('http://localhost:3002');
    expect(clientConfirmPortalBase({ APP_PORTAL_DOMAIN: 'portal.bitcrm.tech-slk.com' })).toBe(
      'https://portal.bitcrm.tech-slk.com',
    );
    expect(clientConfirmPortalBase({})).toBe('');
  });
});
