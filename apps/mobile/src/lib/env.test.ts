import {
  DEV_API_BASE_URL,
  MISSING_API_BASE_URL,
  normalizeApiBaseUrl,
  resolveApiBaseUrl,
} from './env';

describe('normalizeApiBaseUrl', () => {
  it('reports nothing configured as null, rather than guessing', () => {
    expect(normalizeApiBaseUrl(undefined)).toBeNull();
    expect(normalizeApiBaseUrl(null)).toBeNull();
    expect(normalizeApiBaseUrl('   ')).toBeNull();
    expect(normalizeApiBaseUrl('/')).toBeNull();
  });

  it('keeps a URL that already names the gateway prefix', () => {
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

describe('resolveApiBaseUrl', () => {
  it('lets a development build run with nothing configured', () => {
    expect(resolveApiBaseUrl(undefined, { dev: true })).toBe(DEV_API_BASE_URL);
  });

  it('refuses to let a RELEASE build fall back to the dev gateway', () => {
    // Expo inlines EXPO_PUBLIC_* at build time, so a release built without it
    // would ship pointed at dev with nothing failing to give it away — every
    // technician's day list quietly somebody else's test data.
    expect(() => resolveApiBaseUrl(undefined, { dev: false })).toThrow(
      MISSING_API_BASE_URL,
    );
    expect(() => resolveApiBaseUrl('  ', { dev: false })).toThrow(MISSING_API_BASE_URL);
  });

  it('takes the configured gateway in either kind of build', () => {
    expect(resolveApiBaseUrl('https://api.bitcrm.example', { dev: false })).toBe(
      'https://api.bitcrm.example/api',
    );
    expect(resolveApiBaseUrl('https://api.bitcrm.example', { dev: true })).toBe(
      'https://api.bitcrm.example/api',
    );
  });
});
