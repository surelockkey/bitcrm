import { isOnline } from './online';

describe('isOnline', () => {
  it('is offline with no connection at all', () => {
    expect(isOnline({ isConnected: false, isInternetReachable: false })).toBe(false);
    expect(isOnline({ isConnected: false, isInternetReachable: null })).toBe(false);
  });

  it('is offline on a connection that carries nothing — a captive portal, a dead cell', () => {
    expect(isOnline({ isConnected: true, isInternetReachable: false })).toBe(false);
  });

  it('is online while reachability is still unknown, rather than stalling the first fetch', () => {
    expect(isOnline({ isConnected: true, isInternetReachable: null })).toBe(true);
  });

  it('is online when the phone says both', () => {
    expect(isOnline({ isConnected: true, isInternetReachable: true })).toBe(true);
  });
});
