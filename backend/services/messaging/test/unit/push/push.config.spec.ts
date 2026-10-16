import { loadPushConfig } from '../../../src/push/push.config';

describe('loadPushConfig', () => {
  it('is on by default, with no Expo access token', () => {
    expect(loadPushConfig({})).toEqual({ enabled: true, expoAccessToken: undefined });
  });

  it('PUSH_ENABLED is the kill switch', () => {
    for (const off of ['false', 'FALSE', ' 0 ', 'off', 'no']) expect(loadPushConfig({ PUSH_ENABLED: off }).enabled).toBe(false);
    for (const on of ['true', '1', 'yes', '']) expect(loadPushConfig({ PUSH_ENABLED: on }).enabled).toBe(true);
  });

  it('reads EXPO_ACCESS_TOKEN, a blank one as none', () => {
    expect(loadPushConfig({ EXPO_ACCESS_TOKEN: 'tok-1' }).expoAccessToken).toBe('tok-1');
    expect(loadPushConfig({ EXPO_ACCESS_TOKEN: '  ' }).expoAccessToken).toBeUndefined();
  });
});
