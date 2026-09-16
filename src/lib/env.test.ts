import { DEFAULT_API_BASE_URL, normalizeApiBaseUrl } from './env';

describe('normalizeApiBaseUrl', () => {
  it('falls back to the shared gateway when nothing is set', () => {
    expect(normalizeApiBaseUrl(undefined)).toBe(DEFAULT_API_BASE_URL);
    expect(normalizeApiBaseUrl(null)).toBe(DEFAULT_API_BASE_URL);
    expect(normalizeApiBaseUrl('   ')).toBe(DEFAULT_API_BASE_URL);
    expect(normalizeApiBaseUrl('/')).toBe(DEFAULT_API_BASE_URL);
  });

  it('keeps an override that already names the gateway prefix', () => {
    expect(normalizeApiBaseUrl('https://api.bitcrm.tech-slk.com/api')).toBe(
      'https://api.bitcrm.tech-slk.com/api',
    );
  });

  it('appends the gateway prefix to a bare host, as a person would type it', () => {
    expect(normalizeApiBaseUrl('http://192.168.1.20:4000')).toBe(
      'http://192.168.1.20:4000/api',
    );
  });

  it('drops trailing slashes so paths never double up', () => {
    expect(normalizeApiBaseUrl('http://localhost:4000/')).toBe(
      'http://localhost:4000/api',
    );
    expect(normalizeApiBaseUrl('http://localhost:4000/api//')).toBe(
      'http://localhost:4000/api',
    );
  });

  it('trims whitespace a copy-paste leaves behind', () => {
    expect(normalizeApiBaseUrl('  http://localhost:4000  ')).toBe(
      'http://localhost:4000/api',
    );
  });
});
